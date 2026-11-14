'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { formatMoney, type Currency } from '@sw/shared';
import { Alert, Button, Card } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface Session {
  id: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  status: string;
}

/** Stand-in for the payment provider's hosted page (PAYMENTS_MODE=mock). No money moves. */
function MockPayment() {
  const session = useSearchParams().get('session') ?? '';
  const router = useRouter();
  const [s, setS] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Session>(`/v1/checkout/mock/${encodeURIComponent(session)}`)
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, [session]);
  async function finish(outcome: 'paid' | 'expired') {
    setBusy(true);
    try {
      const r = await api<{ order_id: string }>(
        `/v1/checkout/mock/${encodeURIComponent(session)}/complete`,
        { method: 'POST', body: { outcome } },
      );
      router.replace(outcome === 'paid' ? `/orders/${r.order_id}?checkout=success` : '/cart');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (error) return <Alert tone="fail" title={error} />;
  if (!s) return <p className="text-[var(--sw-text-muted)]">{t.common.loading}</p>;
  const total = formatMoney(s.amount_minor, s.currency as Currency);
  return (
    <div className="mx-auto max-w-md">
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold text-[var(--sw-text)]">{t.checkout.mockTitle}</h1>
        <Alert tone="info" title={t.checkout.mockLead} />
        <p
          className="font-mono text-3xl tabular-nums text-[var(--sw-text)]"
          data-testid="mock-amount"
        >
          {total}
        </p>
        {s.status === 'AWAITING_PAYMENT' ? (
          <div className="flex flex-col gap-2">
            <Button onClick={() => finish('paid')} loading={busy} data-testid="mock-pay">
              {t.checkout.mockPay(total)}
            </Button>
            <Button variant="ghost" onClick={() => finish('expired')} disabled={busy}>
              {t.checkout.mockCancel}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => router.replace(`/orders/${s.order_id}`)}>
            {t.orders.order(s.order_id)}
          </Button>
        )}
      </Card>
    </div>
  );
}

export default function MockPaymentPage() {
  return (
    <RequireSignIn>
      <Suspense>
        <MockPayment />
      </Suspense>
    </RequireSignIn>
  );
}
