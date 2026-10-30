'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Spinner } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

interface Summary {
  id: string;
  key: string;
  title: string;
  description: string;
  takes_image: boolean;
  license: { code: string; name: string } | null;
}

export default function CustomizersPage() {
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<{ data: Summary[] }>('/v1/customizers').then((r) => setRows(r.data)).catch(() => setError(true));
  }, []);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.customizers.title}</h1>
        <p className="text-[var(--sw-text-muted)]">{t.customizers.lead}</p>
      </header>
      {error ? <Alert tone="fail" title={t.common.error} /> : null}
      {!rows && !error ? (
        <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
          <Spinner /> {t.common.loading}
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {(rows ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`/customizers/${c.key}`} className="block h-full space-y-2 rounded-lg border border-[var(--sw-border)] p-4 hover:border-[var(--sw-accent)]" data-testid={`customizer-${c.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-[var(--sw-text)]">{c.title}</h2>
                {c.takes_image ? <Badge tone="accent">{t.customizers.takesImage}</Badge> : null}
                {c.license ? <Badge>{c.license.code}</Badge> : null}
              </div>
              <p className="text-sm text-[var(--sw-text-muted)]">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
