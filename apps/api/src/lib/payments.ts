import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@sw/shared';
import type { Env } from '@sw/config';

/**
 * Payment gateways (build prompt 5.5). Both use Stripe's webhook signature scheme
 * (`Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, 5-minute tolerance), so the
 * mock exercises the same verification and processing path as Stripe test mode.
 *
 * Stripe facts this depends on (Stripe API reference, Checkout Sessions and Webhooks):
 * - POST https://api.stripe.com/v1/checkout/sessions (form encoded) with mode=payment,
 *   line_items[n][price_data][currency|unit_amount|product_data][name], line_items[n][quantity],
 *   success_url, cancel_url, client_reference_id, metadata[order_id]; returns { id, url }.
 *   An Idempotency-Key header makes a retried create return the same session.
 * - Events checkout.session.completed / checkout.session.expired carry the session in
 *   data.object with amount_total, currency (lower case), payment_status, payment_intent.
 * - POST /v1/refunds with payment_intent and amount.
 */
export interface SessionLine {
  name: string;
  unitAmountMinor: number;
  quantity: number;
}
export interface PaymentEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      amount_total?: number | null;
      currency?: string | null;
      payment_status?: string | null;
      payment_intent?: string | null;
      client_reference_id?: string | null;
    };
  };
}

export interface Gateway {
  readonly mode: 'mock' | 'stripe-test';
  createSession(o: {
    orderId: string;
    currency: string;
    lines: SessionLine[];
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  verify(raw: Buffer, signature: string | undefined, nowS?: number): PaymentEvent | null;
  refund(
    paymentIntentId: string | null,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}

const TOLERANCE_S = 300;

export function signPayload(
  secret: string,
  raw: string,
  t = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}

export function verifySignature(
  secret: string,
  raw: Buffer,
  header: string | undefined,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const v1s = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S || v1s.length === 0) return false;
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(`${t}.${raw.toString('utf8')}`)
      .digest('hex'),
  );
  return v1s.some((v) => v.length === expected.length && timingSafeEqual(Buffer.from(v), expected));
}

function parse(raw: Buffer): PaymentEvent | null {
  try {
    const e = JSON.parse(raw.toString('utf8')) as PaymentEvent;
    return typeof e.id === 'string' && typeof e.type === 'string' && e.data?.object ? e : null;
  } catch {
    return null;
  }
}

export class MockGateway implements Gateway {
  readonly mode = 'mock' as const;
  constructor(private readonly o: { secret: string; webOrigin: string }) {}
  async createSession() {
    const id = `mcs_${randomBytes(12).toString('hex')}`;
    return { id, url: `${this.o.webOrigin}/checkout/mock?session=${id}` };
  }
  verify(raw: Buffer, signature: string | undefined, nowS?: number) {
    return verifySignature(this.o.secret, raw, signature, nowS) ? parse(raw) : null;
  }
  async refund() {
    return { id: `mre_${randomBytes(8).toString('hex')}` };
  }
  /** Build a signed event the way Stripe would send it. */
  event(type: string, object: PaymentEvent['data']['object']): { raw: string; signature: string } {
    const raw = JSON.stringify({
      id: `evt_mock_${randomBytes(10).toString('hex')}`,
      type,
      data: { object },
    });
    return { raw, signature: signPayload(this.o.secret, raw) };
  }
}

export class StripeTestGateway implements Gateway {
  readonly mode = 'stripe-test' as const;
  constructor(
    private readonly o: {
      secretKey: string;
      webhookSecret: string;
      fetchImpl?: typeof fetch;
      baseUrl?: string;
    },
  ) {}
  private async post(path: string, form: Record<string, string>, idempotencyKey: string) {
    const res = await (this.o.fetchImpl ?? fetch)(
      `${this.o.baseUrl ?? 'https://api.stripe.com'}${path}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.o.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': idempotencyKey,
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !body.id)
      throw new AppError(
        'UNAVAILABLE',
        `Payment provider error: ${body.error?.message ?? res.status}`,
      );
    return body as { id: string; url?: string };
  }
  async createSession(o: Parameters<Gateway['createSession']>[0]) {
    const form: Record<string, string> = {
      mode: 'payment',
      success_url: o.successUrl,
      cancel_url: o.cancelUrl,
      client_reference_id: o.orderId,
      'metadata[order_id]': o.orderId,
    };
    o.lines.forEach((l, i) => {
      form[`line_items[${i}][price_data][currency]`] = o.currency.toLowerCase();
      form[`line_items[${i}][price_data][unit_amount]`] = String(l.unitAmountMinor);
      form[`line_items[${i}][price_data][product_data][name]`] = l.name.slice(0, 250);
      form[`line_items[${i}][quantity]`] = String(l.quantity);
    });
    const s = await this.post('/v1/checkout/sessions', form, o.idempotencyKey);
    if (!s.url) throw new AppError('UNAVAILABLE', 'Payment provider returned no checkout URL');
    return { id: s.id, url: s.url };
  }
  verify(raw: Buffer, signature: string | undefined, nowS?: number) {
    return verifySignature(this.o.webhookSecret, raw, signature, nowS) ? parse(raw) : null;
  }
  async refund(paymentIntentId: string | null, amountMinor: number, idempotencyKey: string) {
    if (!paymentIntentId) throw new AppError('INVALID_STATE', 'No payment to refund');
    return this.post(
      '/v1/refunds',
      { payment_intent: paymentIntentId, amount: String(amountMinor) },
      idempotencyKey,
    );
  }
}

export function gatewayFromEnv(env: Env): Gateway {
  if (env.PAYMENTS_MODE === 'stripe-test')
    return new StripeTestGateway({
      secretKey: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
    });
  return new MockGateway({ secret: env.MOCK_STRIPE_WEBHOOK_SECRET, webOrigin: env.WEB_ORIGIN });
}
