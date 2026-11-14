'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney, type Currency } from '@sw/shared';
import { Alert, Badge, EmptyState, Spinner } from '@sw/ui';
import { orderTone as tone } from '@/components/order-status';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface OrderRow {
  id: string;
  status: string;
  total_minor: number;
  currency: string;
  items: number;
  created_at: string;
}

function Orders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: OrderRow[] }>('/v1/orders')
      .then((r) => setRows(r.data))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.orders.title}</h1>
      {error ? <Alert tone="fail" title={error} /> : null}
      {rows === null && !error ? (
        <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
          <Spinner /> {t.common.loading}
        </p>
      ) : null}
      {rows && rows.length === 0 ? (
        <EmptyState
          title={t.orders.empty}
          action={
            <Link href="/print" className="text-[var(--sw-accent)] underline">
              {t.nav.upload}
            </Link>
          }
        >
          {t.orders.emptyLead}
        </EmptyState>
      ) : null}
      {rows && rows.length ? (
        <ul
          className="divide-y divide-[var(--sw-border)] rounded border border-[var(--sw-border)]"
          data-testid="orders"
        >
          {rows.map((o) => (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-[var(--sw-surface)]"
              >
                <span className="font-medium text-[var(--sw-text)]">{t.orders.order(o.id)}</span>
                <Badge tone={tone(o.status)}>{t.orders.status[o.status] ?? o.status}</Badge>
                <span className="text-[var(--sw-text-muted)]">
                  {t.orders.items(o.items)} ·{' '}
                  {t.orders.placed(new Date(o.created_at).toLocaleDateString())}
                </span>
                <span className="ml-auto font-mono tabular-nums text-[var(--sw-text)]">
                  {formatMoney(o.total_minor, o.currency as Currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <RequireSignIn>
      <Orders />
    </RequireSignIn>
  );
}
