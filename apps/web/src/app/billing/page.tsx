'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

interface Entry {
  id: string;
  kind: string;
  delta: number;
  reserved_delta: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
}

function Billing() {
  const { wallet, refresh } = useSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async (c?: string | null) => {
    setError(false);
    try {
      const r = await api<{ data: Entry[]; next_cursor: string | null }>(`/v1/billing/ledger?limit=20${c ? `&cursor=${c}` : ''}`);
      setEntries((prev) => (c ? [...prev, ...r.data] : r.data));
      setCursor(r.next_cursor);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    void load();
  }, [load, refresh]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.billing.title}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--sw-text-muted)]">{t.billing.available}</p>
          <p className="font-mono text-2xl tabular-nums text-[var(--sw-text)]" data-testid="wallet-available">{wallet?.available ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--sw-text-muted)]">{t.billing.reserved}</p>
          <p className="font-mono text-2xl tabular-nums text-[var(--sw-text)]">{wallet?.reserved ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--sw-text-muted)]">{t.billing.plan}</p>
          <p className="text-2xl capitalize text-[var(--sw-text)]">{wallet?.plan ?? '—'}</p>
        </Card>
      </div>
      {wallet?.expiring.map((e) => (
        <p key={e.expires_at} className="text-sm text-[var(--sw-text-muted)]">
          {t.billing.expiring(e.amount, new Date(e.expires_at).toLocaleDateString())}
        </p>
      ))}
      <p className="text-sm text-[var(--sw-text-muted)]">{t.billing.terms}</p>
      <section aria-labelledby="plans-h" className="space-y-2">
        <h2 id="plans-h" className="text-lg font-semibold text-[var(--sw-text)]">{t.billing.plansTitle}</h2>
        <ul className="grid gap-3 sm:grid-cols-3" data-testid="plan-use">
          {t.billing.planUse.map((p) => (
            <li key={p.name} className="rounded border border-[var(--sw-border)] p-3 text-sm">
              <p className="font-semibold text-[var(--sw-text)]">{p.name}</p>
              <p className="text-[var(--sw-text)]">{p.use}</p>
              <p className="text-xs text-[var(--sw-text-muted)]">{p.formats}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-[var(--sw-text)]">{t.billing.ledger}</h2>
        {error ? <Alert tone="fail" title={t.common.error} action={<Button size="sm" variant="secondary" onClick={() => load()}>{t.common.retry}</Button>} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--sw-text-muted)]">
              <tr>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Entry</th>
                <th className="py-2 pr-4 text-right font-medium">Change</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-[var(--sw-border)]">
                  <td className="py-2 pr-4 text-[var(--sw-text-muted)]">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-[var(--sw-text)]">{t.billing.kinds[e.kind] ?? e.kind}{e.reason ? ` · ${e.reason}` : ''}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">{e.delta === 0 ? (e.reserved_delta > 0 ? `(${e.reserved_delta} held)` : `(${-e.reserved_delta} freed)`) : e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{e.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cursor ? <Button variant="secondary" onClick={() => load(cursor)}>{t.billing.more}</Button> : null}
      </section>
    </div>
  );
}

export default function BillingPage() {
  return (
    <RequireSignIn>
      <Billing />
    </RequireSignIn>
  );
}
