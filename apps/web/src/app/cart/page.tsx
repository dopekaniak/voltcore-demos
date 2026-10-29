'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney } from '@sw/shared';
import { Alert, Badge, Button, EmptyState } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface Cart { items: { id: string; part_id: string; title: string; stale: boolean; quote: { total_minor: number; subtotal_minor: number; is_estimate: boolean; lines: { quantity: number; material: string }[] } }[]; subtotal_minor: number; shipping_minor: number; total_minor: number; orderable: boolean }

function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Cart>('/v1/cart').then(setCart).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (error) return <Alert tone="fail" title={error} action={<Button size="sm" variant="secondary" onClick={load}>{t.common.retry}</Button>} />;
  if (!cart) return <p className="text-[var(--sw-text-muted)]">{t.common.loading}</p>;
  if (!cart.items.length) return <EmptyState title={t.cart.empty} action={<Link href="/print" className="text-[var(--sw-accent)] underline">{t.nav.upload}</Link>} />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.cart.title}</h1>
      <ul className="divide-y divide-[var(--sw-border)] rounded border border-[var(--sw-border)]" data-testid="cart-items">
        {cart.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <Link href={`/print?part=${i.part_id}`} className="font-medium text-[var(--sw-text)] hover:underline">{i.title}</Link>
            <span className="text-[var(--sw-text-muted)]">{i.quote.lines[0]?.material} × {i.quote.lines[0]?.quantity}</span>
            {i.quote.is_estimate ? <Badge tone="warn">{t.print.estimate}</Badge> : null}
            {i.stale ? <span className="text-xs text-[var(--sw-fail)]">{t.cart.stale}</span> : null}
            <span className="ml-auto font-mono tabular-nums">{formatMoney(i.quote.subtotal_minor)}</span>
            <Button size="sm" variant="ghost" onClick={() => api<Cart>(`/v1/cart/items/${i.id}`, { method: 'DELETE' }).then(setCart)}>{t.cart.remove}</Button>
          </li>
        ))}
      </ul>
      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><dt>{t.print.subtotal}</dt><dd className="font-mono tabular-nums">{formatMoney(cart.subtotal_minor)}</dd></div>
        <div className="flex justify-between"><dt>{t.cart.shipping}</dt><dd className="font-mono tabular-nums">{formatMoney(cart.shipping_minor)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>{t.cart.total}</dt><dd className="font-mono tabular-nums" data-testid="cart-total">{formatMoney(cart.total_minor)}</dd></div>
        <p className="text-xs text-[var(--sw-text-muted)]">Tax calculated where applicable.</p>
      </dl>
      <div className="flex justify-end">
        <Link href="/checkout" aria-disabled={!cart.orderable} className={`rounded-md px-4 py-2 text-sm font-medium ${cart.orderable ? 'bg-[var(--sw-accent)] text-[var(--sw-accent-contrast)]' : 'pointer-events-none bg-[var(--sw-surface-2)] text-[var(--sw-text-muted)]'}`} data-testid="checkout">
          {t.cart.checkout}
        </Link>
      </div>
      {!cart.orderable ? <p className="text-right text-xs text-[var(--sw-text-muted)]">{t.print.notOrderable}</p> : null}
    </div>
  );
}

export default function CartPage() {
  return (
    <RequireSignIn>
      <CartView />
    </RequireSignIn>
  );
}
