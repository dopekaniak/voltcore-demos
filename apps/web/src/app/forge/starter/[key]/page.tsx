'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Spinner } from '@sw/ui';
import { ForgeWorkbench } from '@/components/ForgeWorkbench';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

export default function StarterPage() {
  const { key } = useParams<{ key: string }>();
  const [starter, setStarter] = useState<{ key: string; title: string; code: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<{ key: string; title: string; code: string }>(`/v1/forges/starters/${key}`).then(setStarter).catch(() => setError(true));
  }, [key]);
  if (error) return <Alert tone="fail" title={t.errors.notFound}>{t.errors.notFoundLead}</Alert>;
  if (!starter)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  return <ForgeWorkbench title={starter.title} code={starter.code} starterKey={starter.key} />;
}
