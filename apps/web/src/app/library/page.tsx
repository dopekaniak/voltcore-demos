'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Input } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/files';
import { t } from '@/lib/messages';

interface Item {
  id: string;
  kind: string;
  title: string;
  visibility: string;
  thumbnail_file_id: string | null;
  current_version: { id: string; stage: string; files: { id: string; role: string }[]; analysis: { printable?: boolean } | null } | null;
  created_at: string;
}

function Thumb({ item }: { item: Item }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!item.thumbnail_file_id) return;
    api<{ url: string }>(`/v1/assets/${item.id}/files/${item.thumbnail_file_id}/url`).then((r) => setSrc(r.url)).catch(() => undefined);
  }, [item]);
  return src ? <img src={src} alt="" className="h-36 w-full rounded object-cover" /> : <div className="flex h-36 items-center justify-center rounded bg-[var(--sw-surface)] text-xs text-[var(--sw-text-muted)]">{t.library.kinds[item.kind]}</div>;
}

const hrefOf = (i: Item) => (i.kind === 'FORGE' ? `/forge/${i.id}` : `/library/${i.id}`);

function Library() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [kind, setKind] = useState('ALL');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (c?: string | null) => {
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: '24', ...(kind !== 'ALL' ? { kind } : {}), ...(q ? { q } : {}), ...(c ? { cursor: c } : {}) });
        const r = await api<{ data: Item[]; next_cursor: string | null }>(`/v1/assets?${qs}`);
        setItems((p) => (c ? [...(p ?? []), ...r.data] : r.data));
        setCursor(r.next_cursor);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [kind, q],
  );
  useEffect(() => {
    const h = setTimeout(() => void load(), 250);
    return () => clearTimeout(h);
  }, [load]);
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  async function bulkDownload() {
    for (const i of items ?? []) {
      if (!sel.has(i.id)) continue;
      const f = i.current_version?.files.find((x) => ['STL', 'GLB', 'PREVIEW_MESH'].includes(x.role));
      if (f) await downloadFile(i.id, f.id);
    }
  }
  async function bulkDelete() {
    await Promise.all([...sel].map((id) => api(`/v1/assets/${id}`, { method: 'DELETE' })));
    setSel(new Set());
    setConfirm(false);
    void load();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.library.title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <label htmlFor="lib-q" className="sr-only">{t.library.search}</label>
          <Input id="lib-q" placeholder={t.library.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1">
          {Object.entries(t.library.kinds).map(([k, v]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? 'border-[var(--sw-accent)] text-[var(--sw-accent)]' : 'border-[var(--sw-border)] text-[var(--sw-text)]'}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={view === 'grid' ? 'secondary' : 'ghost'} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>{t.library.grid}</Button>
          <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}>{t.library.list}</Button>
        </div>
      </div>
      {sel.size ? (
        <div className="flex items-center gap-2 rounded border border-[var(--sw-border)] p-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="text-[var(--sw-text)]">{t.library.selected(sel.size)}</span>
          <Button size="sm" variant="secondary" onClick={bulkDownload}>{t.library.download}</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{t.library.delete}</Button>
        </div>
      ) : null}
      {error ? <Alert tone="fail" title={error} action={<Button size="sm" variant="secondary" onClick={() => load()}>{t.common.retry}</Button>} /> : null}
      {items && items.length === 0 ? (
        <EmptyState title={t.library.empty} action={<Link href="/" className="text-[var(--sw-accent)] underline">{t.nav.describe}</Link>}>{t.library.emptyLead}</EmptyState>
      ) : null}
      <ul className={view === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' : 'divide-y divide-[var(--sw-border)] rounded border border-[var(--sw-border)]'} data-testid="library-items">
        {(items ?? []).map((i) => (
          <li key={i.id} className={view === 'grid' ? 'space-y-2 rounded-lg border border-[var(--sw-border)] p-2' : 'flex items-center gap-3 p-2'}>
            {view === 'grid' ? <Thumb item={i} /> : null}
            <div className="flex items-start gap-2">
              <input type="checkbox" aria-label={t.library.select(i.title)} checked={sel.has(i.id)} onChange={() => toggle(i.id)} className="mt-1 accent-[var(--sw-accent)]" />
              <div className="min-w-0 flex-1">
                <Link href={hrefOf(i)} className="block truncate font-medium text-[var(--sw-text)] hover:underline">{i.title}</Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge>{t.library.kinds[i.kind]}</Badge>
                  {i.current_version ? <Badge>{t.library.stage[i.current_version.stage] ?? i.current_version.stage}</Badge> : null}
                  {i.current_version?.analysis?.printable === false ? <Badge tone="warn">{t.library.notPrintable}</Badge> : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {cursor ? <Button variant="secondary" onClick={() => load(cursor)}>{t.library.more}</Button> : null}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t.library.delete} footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>{t.common.cancel}</Button><Button variant="danger" onClick={bulkDelete}>{t.library.delete}</Button></>}>
        {t.library.confirmDelete(sel.size)}
      </Dialog>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <RequireSignIn>
      <Library />
    </RequireSignIn>
  );
}
