'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { formatMoney, type Currency } from '@sw/shared';
import { Alert, Badge, Button, Card, Spinner } from '@sw/ui';
import { orderTone as tone } from '@/components/order-status';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface Order {
  id: string;
  status: string;
  total_minor: number;
  subtotal_minor: number;
  shipping_minor: number;
  tax_note: string;
  currency: string;
  is_estimate: boolean;
  created_at: string;
  address: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postal_code: string;
    country: string;
  };
  items: {
    id: string;
    title: string;
    quantity: number;
    line_total_minor: number;
    material: string | null;
    status: string;
    partner_city: string | null;
  }[];
  events: {
    type: string;
    from: string | null;
    to: string | null;
    item_id: string | null;
    note: string | null;
    at: string;
  }[];
  shipments: {
    carrier: string;
    tracking_number: string;
    status: string;
    events: { status: string; at: string }[];
  }[];
  can_cancel: boolean;
  checkout_url: string | null;
  payments_mode: string;
}

const DONE = ['DELIVERED', 'CANCELED', 'EXPIRED', 'REFUNDED'];

function OrderView() {
  const { id } = useParams<{ id: string }>();
  const justPaid = useSearchParams().get('checkout') === 'success';
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<Order>(`/v1/orders/${id}`)
        .then(setO)
        .catch((e: Error) => setError(e.message)),
    [id],
  );
  useEffect(() => void load(), [load]);
  // Follow the order while it moves (payment confirmation, printing, shipping).
  useEffect(() => {
    if (!o || DONE.includes(o.status)) return;
    const h = setInterval(() => void load(), 4000);
    return () => clearInterval(h);
  }, [o, load]);
  async function cancel() {
    setBusy(true);
    try {
      setO(await api<Order>(`/v1/orders/${id}/cancel`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error && !o) return <Alert tone="fail" title={error} />;
  if (!o)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  const money = (n: number) => formatMoney(n, o.currency as Currency);
  const timeline = o.events.filter(
    (e) => e.type === 'status' || e.type === 'routing_failed' || e.type === 'payment_mismatch',
  );
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.orders.order(o.id)}</h1>
          <span data-testid="order-status">
            <Badge tone={tone(o.status)}>{t.orders.status[o.status] ?? o.status}</Badge>
          </span>
        </div>
        {justPaid && o.status !== 'AWAITING_PAYMENT' ? (
          <Alert tone="pass" title={t.orders.thanks} />
        ) : null}
        {o.payments_mode === 'mock' ? (
          <p className="text-xs text-[var(--sw-text-muted)]">{t.orders.mockNote}</p>
        ) : null}
        {o.is_estimate ? (
          <p className="text-xs text-[var(--sw-text-muted)]">{t.orders.estimate}</p>
        ) : null}
        {error ? <Alert tone="fail" title={error} /> : null}
        <ul
          className="divide-y divide-[var(--sw-border)] rounded border border-[var(--sw-border)]"
          data-testid="order-items"
        >
          {o.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="font-medium text-[var(--sw-text)]">{i.title}</span>
              <span className="text-[var(--sw-text-muted)]">
                {i.material} × {i.quantity}
              </span>
              <Badge>{t.orders.itemStatus[i.status] ?? i.status}</Badge>
              {i.partner_city ? (
                <span className="text-xs text-[var(--sw-text-muted)]">
                  {t.orders.partner(i.partner_city)}
                </span>
              ) : null}
              <span className="ml-auto font-mono tabular-nums">{money(i.line_total_minor)}</span>
            </li>
          ))}
        </ul>
        {o.shipments.map((s) => (
          <Card
            key={s.tracking_number}
            className="space-y-1 p-3 text-sm"
            data-testid="order-tracking"
          >
            <h2 className="font-semibold text-[var(--sw-text)]">{t.orders.tracking}</h2>
            <p className="text-[var(--sw-text)]">
              {s.carrier} · <span className="font-mono">{s.tracking_number}</span> ·{' '}
              {s.status.replace(/_/g, ' ')}
            </p>
          </Card>
        ))}
        <section className="space-y-2">
          <h2 className="font-semibold text-[var(--sw-text)]">{t.orders.timeline}</h2>
          <ol
            className="space-y-1 border-l border-[var(--sw-border)] pl-4 text-sm"
            data-testid="order-timeline"
          >
            {timeline.map((e, n) => (
              <li key={n}>
                <span className="text-[var(--sw-text)]">
                  {e.to ? (t.orders.status[e.to] ?? e.to) : e.note}
                </span>
                {e.to && e.note ? (
                  <span className="text-[var(--sw-text-muted)]"> — {e.note}</span>
                ) : null}
                <span className="ml-2 text-xs text-[var(--sw-text-muted)]">
                  {new Date(e.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <aside className="space-y-3">
        <Card className="space-y-1 p-4 text-sm">
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt>{t.print.subtotal}</dt>
              <dd className="font-mono tabular-nums">{money(o.subtotal_minor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t.cart.shipping}</dt>
              <dd className="font-mono tabular-nums">{money(o.shipping_minor)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t.cart.total}</dt>
              <dd className="font-mono tabular-nums">{money(o.total_minor)}</dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--sw-text-muted)]">{o.tax_note}</p>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="font-semibold text-[var(--sw-text)]">{t.orders.shipTo}</h2>
          <address className="not-italic text-[var(--sw-text)]">
            {o.address.name}
            <br />
            {o.address.line1}
            {o.address.line2 ? <>, {o.address.line2}</> : null}
            <br />
            {o.address.city}, {o.address.region} {o.address.postal_code}
          </address>
        </Card>
        {o.checkout_url ? (
          <a
            href={o.checkout_url}
            className="block rounded-md bg-[var(--sw-accent)] px-4 py-2 text-center text-sm font-medium text-[var(--sw-accent-contrast)]"
          >
            {t.orders.pay}
          </a>
        ) : null}
        {o.can_cancel ? (
          <div className="space-y-1">
            <Button
              variant="secondary"
              className="w-full"
              onClick={cancel}
              loading={busy}
              data-testid="order-cancel"
            >
              {o.status === 'PAID' ? t.orders.cancelPaid : t.orders.cancel}
            </Button>
            {o.status === 'PAID' ? (
              <p className="text-xs text-[var(--sw-text-muted)]">{t.orders.cancelHelp}</p>
            ) : null}
          </div>
        ) : null}
        <Link href="/orders" className="text-sm text-[var(--sw-accent)] underline">
          {t.orders.title}
        </Link>
      </aside>
    </div>
  );
}

export default function OrderPage() {
  return (
    <RequireSignIn>
      <Suspense>
        <OrderView />
      </Suspense>
    </RequireSignIn>
  );
}
