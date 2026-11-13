'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, EmptyState, Spinner } from '@sw/ui';
import type { Comment } from '@/components/community/types';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

const DAYS = 30;

interface Stats {
  totals: {
    models: number;
    downloads: number;
    likes: number;
    saves: number;
    followers: number;
    downloads_in_period: number;
  };
  models: {
    id: string;
    title: string;
    publish_status: string;
    downloads: number;
    likes: number;
    saves: number;
    downloads_in_period: number;
  }[];
  recent_comments: (Comment & { model_id: string; model_title: string })[];
}

function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Stats>(`/v1/creator/stats?days=${DAYS}`)
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Alert tone="fail" title={error} />;
  if (!s)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  const tiles: [string, number][] = [
    [t.community.statModels, s.totals.models],
    [t.community.statDownloads, s.totals.downloads],
    [t.community.statPeriod, s.totals.downloads_in_period],
    [t.community.statLikes, s.totals.likes],
    [t.community.statSaves, s.totals.saves],
    [t.community.statFollowers, s.totals.followers],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.community.statsTitle}</h1>
        <p className="text-sm text-[var(--sw-text-muted)]">{t.community.statsLead(DAYS)}</p>
      </div>
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        data-testid="creator-tiles"
      >
        {tiles.map(([k, v]) => (
          <li key={k}>
            <Card className="p-3">
              <p className="text-xs text-[var(--sw-text-muted)]">{k}</p>
              <p className="font-mono text-2xl tabular-nums text-[var(--sw-text)]">
                {v.toLocaleString('en-US')}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {s.models.length === 0 ? (
        <EmptyState
          title={t.community.noStats}
          action={
            <Link href="/library" className="text-[var(--sw-accent)] underline">
              {t.nav.library}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--sw-text-muted)]">
              <tr>
                <th className="py-1 pr-3 font-medium">{t.nav.models}</th>
                <th className="py-1 pr-3 font-medium" />
                <th className="py-1 pr-3 text-right font-medium">{t.community.statDownloads}</th>
                <th className="py-1 pr-3 text-right font-medium">{t.community.statPeriod}</th>
                <th className="py-1 pr-3 text-right font-medium">{t.community.statLikes}</th>
                <th className="py-1 text-right font-medium">{t.community.statSaves}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sw-border)]">
              {s.models.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3">
                    <Link
                      className="text-[var(--sw-text)] hover:underline"
                      href={`/library/${m.id}`}
                    >
                      {m.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={m.publish_status === 'PUBLISHED' ? 'pass' : 'warn'}>
                      {t.community.status[m.publish_status] ?? m.publish_status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{m.downloads}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">
                    {m.downloads_in_period}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{m.likes}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{m.saves}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.recent_comments.length ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-[var(--sw-text)]">
            {t.community.recentComments}
          </h2>
          <ul className="space-y-2">
            {s.recent_comments.map((c) => (
              <li key={c.id} className="rounded border border-[var(--sw-border)] p-2 text-sm">
                <p className="text-xs text-[var(--sw-text-muted)]">
                  {c.author.handle ?? c.author.name ?? t.community.aMaker} ·{' '}
                  <Link className="underline" href={`/models/${c.model_id}`}>
                    {c.model_title}
                  </Link>
                </p>
                <p className="text-[var(--sw-text)]">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function CreatorDashboardPage() {
  return (
    <RequireSignIn>
      <Dashboard />
    </RequireSignIn>
  );
}
