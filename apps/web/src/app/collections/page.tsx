'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Input } from '@sw/ui';
import { ModelGrid } from '@/components/community/ModelCard';
import type { CollectionData, ModelCardData } from '@/components/community/types';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

function Collections() {
  const [rows, setRows] = useState<CollectionData[] | null>(null);
  const [saved, setSaved] = useState<ModelCardData[] | null>(null);
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ data: CollectionData[] }>('/v1/collections')
      .then((r) => setRows(r.data))
      .catch((e: Error) => setError(e.message));
    api<{ data: ModelCardData[] }>('/v1/community/saved')
      .then((r) => setSaved(r.data))
      .catch(() => setSaved([]));
  }, []);
  useEffect(load, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/collections', {
        method: 'POST',
        body: { title: title.trim(), is_public: isPublic },
      });
      setTitle('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">
        {t.community.collectionsTitle}
      </h1>
      {error ? <Alert tone="fail" title={error} /> : null}
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--sw-text)]">{t.community.collectionName}</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            required
            data-testid="collection-name"
          />
        </label>
        <label className="flex items-center gap-1 pb-2 text-sm text-[var(--sw-text)]">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />{' '}
          {t.community.makePublic}
        </label>
        <Button type="submit" disabled={!title.trim()} data-testid="collection-create">
          {t.community.newCollection}
        </Button>
      </form>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="collections">
        {(rows ?? []).map((c) => (
          <li key={c.id}>
            <Card className="space-y-1 p-3">
              <Link
                href={`/collections/${c.id}`}
                className="font-medium text-[var(--sw-text)] hover:underline"
              >
                {c.title}
              </Link>
              <p className="flex items-center gap-2 text-xs text-[var(--sw-text-muted)]">
                <Badge>
                  {c.is_public ? t.community.publicCollection : t.community.privateCollection}
                </Badge>{' '}
                {t.community.models(c.items)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--sw-text)]">{t.community.savedTitle}</h2>
        {saved && saved.length === 0 ? (
          <EmptyState title={t.community.savedEmpty} />
        ) : (
          <ModelGrid models={saved ?? []} />
        )}
      </section>
    </div>
  );
}

export default function CollectionsPage() {
  return (
    <RequireSignIn>
      <Collections />
    </RequireSignIn>
  );
}
