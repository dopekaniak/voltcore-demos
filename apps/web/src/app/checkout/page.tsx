'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney } from '@sw/shared';
import { Alert, Button, Card, EmptyState, Input } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/messages';

interface Cart {
  items: {
    id: string;
    title: string;
    quote: { subtotal_minor: number; lines: { quantity: number; material: string }[] };
  }[];
  subtotal_minor: number;
  shipping_minor: number;
  total_minor: number;
  orderable: boolean;
}

const FIELDS = [
  ['name', t.checkout.name, 'name'],
  ['line1', t.checkout.line1, 'address-line1'],
  ['line2', t.checkout.line2, 'address-line2'],
  ['city', t.checkout.city, 'address-level2'],
  ['region', t.checkout.region, 'address-level1'],
  ['postal_code', t.checkout.postal, 'postal-code'],
  ['phone', t.checkout.phone, 'tel'],
] as const;

function Checkout() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [addr, setAddr] = useState<Record<string, string>>({ country: 'US' });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; cart?: boolean } | null>(null);
  useEffect(() => {
    api<Cart>('/v1/cart')
      .then(setCart)
      .catch((e: Error) => setError({ text: e.message }));
  }, []);
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const address = Object.fromEntries(Object.entries(addr).filter(([, v]) => v.trim() !== ''));
      const r = await api<{ checkout_url: string }>('/v1/checkout', {
        method: 'POST',
        body: { address, accept_terms: true },
        idempotent: true,
      });
      window.location.assign(r.checkout_url);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError({
        text:
          code === 'QUOTE_CHANGED' || code === 'QUOTE_EXPIRED'
            ? t.checkout.priceChanged
            : (err as Error).message,
        cart: code.startsWith('QUOTE'),
      });
      setBusy(false);
    }
  }
  if (!cart)
    return error ? (
      <Alert tone="fail" title={error.text} />
    ) : (
      <p className="text-[var(--sw-text-muted)]">{t.common.loading}</p>
    );
  if (!cart.items.length)
    return (
      <EmptyState
        title={t.checkout.empty}
        action={
          <Link href="/print" className="text-[var(--sw-accent)] underline">
            {t.nav.upload}
          </Link>
        }
      />
    );
  return (
    <form onSubmit={pay} className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.checkout.title}</h1>
        <fieldset className="space-y-3">
          <legend className="font-semibold text-[var(--sw-text)]">{t.checkout.shipTo}</legend>
          {FIELDS.map(([k, label, auto]) => (
            <label key={k} className="block space-y-1 text-sm">
              <span className="text-[var(--sw-text)]">{label}</span>
              <Input
                value={addr[k] ?? ''}
                onChange={(e) => setAddr((a) => ({ ...a, [k]: e.target.value }))}
                required={k !== 'line2' && k !== 'phone'}
                autoComplete={auto}
                maxLength={k === 'postal_code' ? 20 : 200}
                data-testid={`checkout-${k}`}
              />
            </label>
          ))}
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--sw-text)]">{t.checkout.country}</span>
            <select
              value="US"
              disabled
              className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-[var(--sw-text)]"
            >
              <option value="US">United States</option>
            </select>
            <span className="block text-xs text-[var(--sw-text-muted)]">{t.checkout.usOnly}</span>
          </label>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-[var(--sw-text)]">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            required
            data-testid="checkout-terms"
          />
          {t.checkout.terms}{' '}
          <Link href="/legal/terms" className="text-[var(--sw-accent)] underline" target="_blank">
            {t.checkout.termsLink}
          </Link>
        </label>
      </div>
      <aside className="space-y-3">
        <Card className="space-y-2 p-4 text-sm">
          <h2 className="font-semibold text-[var(--sw-text)]">{t.checkout.summary}</h2>
          <ul className="space-y-1">
            {cart.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span className="text-[var(--sw-text)]">
                  {i.title}{' '}
                  <span className="text-[var(--sw-text-muted)]">
                    {i.quote.lines[0]?.material} × {i.quote.lines[0]?.quantity}
                  </span>
                </span>
                <span className="font-mono tabular-nums">
                  {formatMoney(i.quote.subtotal_minor)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-[var(--sw-border)] pt-2">
            <div className="flex justify-between">
              <dt>{t.print.subtotal}</dt>
              <dd className="font-mono tabular-nums">{formatMoney(cart.subtotal_minor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t.cart.shipping}</dt>
              <dd className="font-mono tabular-nums">{formatMoney(cart.shipping_minor)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t.cart.total}</dt>
              <dd className="font-mono tabular-nums" data-testid="checkout-total">
                {formatMoney(cart.total_minor)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--sw-text-muted)]">Tax calculated where applicable.</p>
        </Card>
        {error ? (
          <Alert
            tone="fail"
            title={error.text}
            action={
              error.cart ? (
                <Link href="/cart" className="text-sm underline">
                  {t.cart.title}
                </Link>
              ) : undefined
            }
          />
        ) : null}
        <Button
          type="submit"
          className="w-full"
          loading={busy}
          disabled={!terms || !cart.orderable}
          data-testid="checkout-pay"
        >
          {t.checkout.pay(formatMoney(cart.total_minor))}
        </Button>
        {!cart.orderable ? (
          <p className="text-xs text-[var(--sw-text-muted)]">{t.print.notOrderable}</p>
        ) : null}
      </aside>
    </form>
  );
}

export default function CheckoutPage() {
  return (
    <RequireSignIn>
      <Checkout />
    </RequireSignIn>
  );
}
