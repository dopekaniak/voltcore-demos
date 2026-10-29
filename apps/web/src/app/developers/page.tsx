'use client';
import { useEffect, useState } from 'react';
import { SCOPES } from '@sw/shared';
import { Alert, Button, Card, EmptyState, Input } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface Key {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
}

function Developers() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['forge:read', 'forge:write']);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ data: Key[] }>('/v1/api-keys').then((r) => setKeys(r.data)).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ key: string }>('/v1/api-keys', { method: 'POST', body: { name, scopes } });
      setCreated(r.key);
      setName('');
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.developers.title}</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--sw-text)]">{t.developers.keys}</h2>
        <p className="text-sm text-[var(--sw-text-muted)]">{t.developers.keysLead}</p>
        {created ? (
          <Alert tone="pass" title={t.developers.shownOnce}>
            <code className="break-all font-mono text-xs">{created}</code>
          </Alert>
        ) : null}
        {error ? <Alert tone="fail" title={error} /> : null}
        <Card className="p-4">
          <form onSubmit={create} className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-[var(--sw-text)]">{t.developers.keyName}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-[var(--sw-text)]">{t.developers.scopes}</legend>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 font-mono text-xs text-[var(--sw-text)]">
                    <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))} className="accent-[var(--sw-accent)]" />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={!name || !scopes.length}>
              {t.developers.newKey}
            </Button>
          </form>
        </Card>
        {keys && keys.length === 0 ? <EmptyState title={t.developers.noKeys} /> : null}
        <ul className="space-y-2">
          {keys?.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 rounded border border-[var(--sw-border)] p-3 text-sm">
              <span className="font-medium text-[var(--sw-text)]">{k.name}</span>
              <code className="font-mono text-xs text-[var(--sw-text-muted)]">sw_live_{k.prefix}_…</code>
              <span className="font-mono text-xs text-[var(--sw-text-muted)]">{k.scopes.join(' ')}</span>
              <Button className="ml-auto" size="sm" variant="secondary" onClick={() => api(`/v1/api-keys/${k.id}`, { method: 'DELETE' }).then(load)}>
                {t.developers.revoke}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <RequireSignIn>
      <Developers />
    </RequireSignIn>
  );
}
