'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Spinner } from '@sw/ui';
import { ModelCard } from '@/components/community/ModelCard';
import type { CollectionData, ModelCardData } from '@/components/community/types';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

type Full = CollectionData & { models: ModelCardData[] };

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Full | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Full>(`/v1/collections/${id}`)
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const move = (i: number, d: -1 | 1) => {
    if (!c) return;
    const ids = c.models.map((m) => m.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    void run(() => api(`/v1/collections/${id}/order`, { method: 'PUT', body: { model_ids: ids } }));
  };
  if (error && !c) return <Alert tone="fail" title={error} />;
  if (!c)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{c.title}</h1>
        <Badge>{c.is_public ? t.community.publicCollection : t.community.privateCollection}</Badge>
        {c.owner.handle ? (
          <Link
            href={`/creators/${c.owner.handle}`}
            className="text-sm text-[var(--sw-accent)] underline"
          >
            {c.owner.handle}
          </Link>
        ) : null}
      </div>
      {c.description ? <p className="text-[var(--sw-text-muted)]">{c.description}</p> : null}
      {error ? <Alert tone="fail" title={error} /> : null}
      {c.is_owner ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              run(() =>
                api(`/v1/collections/${id}`, {
                  method: 'PATCH',
                  body: { is_public: !c.is_public },
                }),
              )
            }
          >
            {c.is_public ? t.community.privateCollection : t.community.makePublic}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              run(async () => {
                await api(`/v1/collections/${id}`, { method: 'DELETE' });
                router.push('/collections');
              })
            }
          >
            {t.community.deleteCollection}
          </Button>
        </div>
      ) : null}
      {c.models.length === 0 ? (
        <EmptyState
          title={t.community.emptyCollection}
          action={
            <Link href="/models" className="text-[var(--sw-accent)] underline">
              {t.community.browseTitle}
            </Link>
          }
        />
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="collection-models"
        >
          {c.models.map((m, i) => (
            <li key={m.id} className="space-y-1">
              <ModelCard m={m} />
              {c.is_owner ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`${t.community.moveUp}: ${m.title}`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === c.models.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`${t.community.moveDown}: ${m.title}`}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => api(`/v1/collections/${id}/items/${m.id}`, { method: 'DELETE' }))
                    }
                  >
                    {t.community.removeFromCollection}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
