'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, EmptyState, Spinner } from '@sw/ui';
import { ModelGrid } from '@/components/community/ModelCard';
import type { ModelCardData } from '@/components/community/types';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

interface Creator {
  handle: string;
  name: string | null;
  bio: string | null;
  followers: number;
  following: boolean;
  is_me: boolean;
  models: number;
  downloads: number;
  joined_at: string;
}

export default function CreatorPage() {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();
  const { me } = useSession();
  const [c, setC] = useState<Creator | null>(null);
  const [models, setModels] = useState<ModelCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Creator>(`/v1/creators/${encodeURIComponent(handle)}`)
      .then(setC)
      .catch((e: Error) => setError(e.message));
    api<{ data: ModelCardData[] }>(
      `/v1/community/models?creator=${encodeURIComponent(handle)}&sort=newest&limit=48`,
    )
      .then((r) => setModels(r.data))
      .catch(() => setModels([]));
  }, [handle]);
  async function follow() {
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/creators/${handle}`)}`);
    try {
      const r = await api<{ active: boolean; count: number }>(
        `/v1/creators/${encodeURIComponent(handle)}/follow`,
        { method: c!.following ? 'DELETE' : 'PUT' },
      );
      setC((x) => (x ? { ...x, following: r.active, followers: r.count } : x));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (error && !c) return <Alert tone="fail" title={error} />;
  if (!c)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]" data-testid="creator-handle">
          {c.handle}
        </h1>
        {c.name ? <p className="text-[var(--sw-text-muted)]">{c.name}</p> : null}
        {c.bio ? <p className="whitespace-pre-line text-[var(--sw-text)]">{c.bio}</p> : null}
        <p className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">
          {t.community.followers(c.followers)} · {t.community.models(c.models)} ·{' '}
          {t.community.downloads(c.downloads)} ·{' '}
          {t.community.joined(new Date(c.joined_at).toLocaleDateString())}
        </p>
        {!c.is_me ? (
          <Button size="sm" variant="secondary" onClick={follow} data-testid="creator-page-follow">
            {c.following ? t.community.following : t.community.follow}
          </Button>
        ) : null}
      </div>
      {error ? <Alert tone="fail" title={error} /> : null}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--sw-text)]">{t.community.creatorModels}</h2>
        {models && models.length === 0 ? (
          <EmptyState title={t.community.noResults} />
        ) : (
          <ModelGrid models={models ?? []} />
        )}
      </section>
    </div>
  );
}
