import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromApiId, newId, toApiId } from '@sw/shared';
import { choosePrinter } from '@sw/db';
import { MockGateway, signPayload, verifySignature } from '../src/lib/payments';
import { as, makeTestApp, signIn } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let blocked: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp({ ESTIMATE_ORDERS: 'allow-dev', PAYMENTS_MODE: 'mock', ORDER_ROUTE_DELAY_MS: 0 });
  blocked = await makeTestApp({ ESTIMATE_ORDERS: 'block', PAYMENTS_MODE: 'mock' });
});
afterAll(async () => {
  await t.close();
  await blocked.close();
});

type App = typeof t;
const address = { name: 'Ada Maker', line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' };
const facts = { volume_mm3: 8000, surface_area_mm2: 2400, bbox_mm: [20, 20, 20], overhang_area_mm2: 0, watertight: true, manifold: true, printable: true };

/** A signed-in buyer with one ready part quoted and in the cart. */
async function buyerWithCart(app: App) {
  const s = await signIn(app);
  const call = as(app, s.cookie);
  const partId = newId();
  await app.ctx.db.printPart.create({ data: { id: partId, ownerId: fromApiId('user', s.userId)!, title: 'Test cube', status: 'READY', analysis: facts, settings: {} } });
  const q = await call('POST', '/v1/print/quotes', { part_id: toApiId('part', partId) }, { 'idempotency-key': newId() });
  expect(q.statusCode).toBe(201);
  const cart = await call('POST', '/v1/cart/items', { quote_id: q.json().id });
  expect(cart.statusCode).toBe(201);
  return { ...s, call, quote: q.json(), cart: cart.json() };
}

const checkout = (call: ReturnType<typeof as>, body: object = { address, accept_terms: true }) => call('POST', '/v1/checkout', body, { 'idempotency-key': newId() });

describe('Checkout', () => {
  it('creates an order awaiting payment at the server-computed total and a payment session', async () => {
    const b = await buyerWithCart(t);
    const r = await checkout(b.call);
    expect(r.statusCode).toBe(201);
    const { order, checkout_url } = r.json();
    expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', total_minor: b.cart.total_minor, currency: 'USD', can_cancel: true });
    expect(order.items).toHaveLength(1);
    expect(checkout_url).toMatch(/\/checkout\/mock\?session=mcs_[0-9a-f]+$/);
  });

  it('refuses an empty cart, a missing terms acceptance, and an unsupported country', async () => {
    const s = await signIn(t);
    expect((await checkout(as(t, s.cookie))).json().error.code).toBe('INVALID_STATE');
    const b = await buyerWithCart(t);
    expect((await checkout(b.call, { address })).statusCode).toBe(400);
    expect((await checkout(b.call, { address: { ...address, country: 'FR' }, accept_terms: true })).json().error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses estimate prices unless estimate orders are allowed (never in production)', async () => {
    const b = await buyerWithCart(blocked);
    const r = await checkout(b.call);
    expect(r.json().error.code).toBe('ESTIMATE_NOT_ORDERABLE');
  });

  it('needs sign-in', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/v1/checkout', payload: { address, accept_terms: true }, headers: { origin: 'http://localhost:3000', 'idempotency-key': newId() } })).statusCode).toBe(401);
  });
});

describe('Payment events', () => {
  async function awaiting() {
    const b = await buyerWithCart(t);
    const { order, checkout_url } = (await checkout(b.call)).json();
    return { b, order, session: new URL(checkout_url).searchParams.get('session')! };
  }
  const mock = () => new MockGateway({ secret: t.ctx.env.MOCK_STRIPE_WEBHOOK_SECRET, webOrigin: t.ctx.env.WEB_ORIGIN });
  const send = (raw: string, signature: string) => t.app.inject({ method: 'POST', url: '/v1/webhooks/payments', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload: raw });

  it('rejects an unsigned or tampered event and leaves the order unpaid', async () => {
    const { b, order, session } = await awaiting();
    const ev = mock().event('checkout.session.completed', { id: session, amount_total: order.total_minor, currency: 'usd', payment_status: 'paid' });
    expect((await send(ev.raw, 't=1,v1=deadbeef')).statusCode).toBe(400);
    expect((await send(ev.raw.replace('"paid"', '"paid" '), ev.signature)).statusCode).toBe(400);
    expect((await b.call('GET', `/v1/orders/${order.id}`)).json().status).toBe('AWAITING_PAYMENT');
  });

  it('marks the order paid once, even when the event is delivered twice', async () => {
    const { b, order, session } = await awaiting();
    const ev = mock().event('checkout.session.completed', { id: session, amount_total: order.total_minor, currency: 'usd', payment_status: 'paid', payment_intent: `mpi_${newId()}` });
    expect((await send(ev.raw, ev.signature)).json()).toEqual({ received: true, duplicate: false });
    expect((await send(ev.raw, ev.signature)).json()).toEqual({ received: true, duplicate: true });
    const o = (await b.call('GET', `/v1/orders/${order.id}`)).json();
    expect(o.status).toBe('PAID');
    expect(o.events.filter((e: { to: string }) => e.to === 'PAID')).toHaveLength(1);
    // The cart is emptied and the quote is used up.
    expect((await b.call('GET', '/v1/cart')).json().items).toHaveLength(0);
    const id = fromApiId('order', order.id)!;
    expect(await t.ctx.db.outboxMessage.count({ where: { topic: 'email', key: `order-paid:${id}` } })).toBe(1);
    expect(await t.ctx.db.outboxMessage.count({ where: { topic: 'order', key: `route:${id}` } })).toBe(1);
  });

  it('does not mark the order paid when the amount or currency differs', async () => {
    const { b, order, session } = await awaiting();
    const low = mock().event('checkout.session.completed', { id: session, amount_total: order.total_minor - 1, currency: 'usd', payment_status: 'paid' });
    await send(low.raw, low.signature);
    const eur = mock().event('checkout.session.completed', { id: session, amount_total: order.total_minor, currency: 'eur', payment_status: 'paid' });
    await send(eur.raw, eur.signature);
    const o = (await b.call('GET', `/v1/orders/${order.id}`)).json();
    expect(o.status).toBe('AWAITING_PAYMENT');
    expect(o.events.filter((e: { type: string }) => e.type === 'payment_mismatch')).toHaveLength(2);
  });

  it('expires an abandoned payment', async () => {
    const { b, order, session } = await awaiting();
    const r = await b.call('POST', `/v1/checkout/mock/${session}/complete`, { outcome: 'expired' });
    expect(r.json().status).toBe('EXPIRED');
    expect((await b.call('GET', `/v1/orders/${order.id}`)).json().can_cancel).toBe(false);
  });

  it('the mock payment page pays through the signed webhook path', async () => {
    const { b, order, session } = await awaiting();
    expect((await b.call('GET', `/v1/checkout/mock/${session}`)).json()).toMatchObject({ order_id: order.id, amount_minor: order.total_minor });
    const other = await signIn(t);
    expect((await as(t, other.cookie)('POST', `/v1/checkout/mock/${session}/complete`, { outcome: 'paid' })).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/checkout/mock/${session}/complete`, { outcome: 'paid' })).json().status).toBe('PAID');
  });
});

describe('Orders', () => {
  it('cancels before payment, and refunds in full within the cancel window', async () => {
    const a = await buyerWithCart(t);
    const o1 = (await checkout(a.call)).json().order;
    expect((await a.call('POST', `/v1/orders/${o1.id}/cancel`)).json().status).toBe('CANCELED');

    const b = await buyerWithCart(t);
    const { order, checkout_url } = (await checkout(b.call)).json();
    await b.call('POST', `/v1/checkout/mock/${new URL(checkout_url).searchParams.get('session')}/complete`, { outcome: 'paid' });
    const c = (await b.call('POST', `/v1/orders/${order.id}/cancel`)).json();
    expect(c.status).toBe('CANCELED');
    const id = fromApiId('order', order.id)!;
    expect(await t.ctx.db.payment.findFirstOrThrow({ where: { orderId: id } })).toMatchObject({ status: 'REFUNDED', refundedMinor: order.total_minor });
    expect(await t.ctx.db.refund.count({ where: { orderId: id, status: 'SUCCEEDED' } })).toBe(1);
    expect((await b.call('POST', `/v1/orders/${order.id}/cancel`)).json().error.code).toBe('INVALID_STATE');
  });

  it("lists only the buyer's orders; another user's order is 404", async () => {
    const b = await buyerWithCart(t);
    const { order } = (await checkout(b.call)).json();
    expect((await b.call('GET', '/v1/orders')).json().data.map((o: { id: string }) => o.id)).toContain(order.id);
    const other = await signIn(t);
    const call = as(t, other.cookie);
    expect((await call('GET', '/v1/orders')).json().data).toEqual([]);
    expect((await call('GET', `/v1/orders/${order.id}`)).statusCode).toBe(404);
    expect((await call('POST', `/v1/orders/${order.id}/cancel`)).statusCode).toBe(404);
  });
});

describe('Payment signatures and routing (pure)', () => {
  it('verifies the Stripe signature scheme with a 5-minute tolerance', () => {
    const raw = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    const sig = signPayload('whsec_test', raw, now);
    expect(verifySignature('whsec_test', Buffer.from(raw), sig, now + 299)).toBe(true);
    expect(verifySignature('whsec_test', Buffer.from(raw), sig, now + 301)).toBe(false);
    expect(verifySignature('whsec_other', Buffer.from(raw), sig, now)).toBe(false);
    expect(verifySignature('whsec_test', Buffer.from(raw), undefined, now)).toBe(false);
  });

  it('routes to an active printer with the material and room, shortest queue first', () => {
    const p = (id: string, materials: string[], bed: [number, number, number], queue: number, active = true) => ({ id, partnerId: 'x', materials, bedMm: bed, queueMinutes: queue, active });
    const printers = [p('a', ['PLA'], [256, 256, 256], 120), p('b', ['PLA', 'PETG'], [220, 220, 250], 30), p('c', ['PLA'], [100, 100, 100], 0), p('d', ['PLA'], [300, 300, 300], 0, false)];
    expect(choosePrinter(printers, { material: 'PLA', bboxMm: [150, 150, 150] })?.id).toBe('b');
    expect(choosePrinter(printers, { material: 'PLA', bboxMm: [240, 100, 100] })?.id).toBe('a');
    expect(choosePrinter(printers, { material: 'PLA', bboxMm: [50, 50, 50] })?.id).toBe('c');
    expect(choosePrinter(printers, { material: 'ASA', bboxMm: [50, 50, 50] })).toBeNull();
    expect(choosePrinter(printers, { material: 'PLA', bboxMm: [280, 280, 280] })).toBeNull();
  });
});
