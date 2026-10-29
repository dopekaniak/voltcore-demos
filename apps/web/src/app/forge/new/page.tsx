'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '@sw/ui';
import { api, followJob, type Job } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

const PHASES = ['DRAFT', 'AUTHORING', 'STATIC_CHECK', 'BUILDING', 'VERIFYING', 'READY'];

function Progress() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const jobId = params.get('job');
  const [job, setJob] = useState<Job | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!jobId) return;
    return followJob(jobId, (j) => {
      setJob(j);
      if (j.status === 'SUCCEEDED' && j.output?.forge_id) {
        void refresh();
        router.replace(`/forge/${j.output.forge_id}`);
      }
      if (j.status === 'FAILED') void refresh();
    });
  }, [jobId, router, refresh]);
  const state = job?.forge_state ?? 'DRAFT';
  const idx = PHASES.indexOf(state);
  async function retry() {
    setRetrying(true);
    const next = await api<Job>(`/v1/jobs/${jobId}/retry`, { method: 'POST', idempotent: true }).catch(() => null);
    setRetrying(false);
    if (next) router.replace(`/forge/new?job=${next.id}`);
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 pt-6">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.forge.building}</h1>
      {job?.status === 'FAILED' ? (
        <Alert tone="fail" title={t.forge.failed} action={<Button size="sm" variant="secondary" onClick={retry} loading={retrying}>{t.common.retry}</Button>}>
          <p data-testid="forge-error">{job.error?.message}</p>
          <p className="mt-1">{t.forge.failedHelp}</p>
          <Link href="/" className="underline">
            {t.errors.home}
          </Link>
        </Alert>
      ) : (
        <ol className="space-y-2" aria-live="polite" data-testid="forge-phases">
          {PHASES.slice(1).map((ph, i) => (
            <li key={ph} className="flex items-center gap-2 text-sm">
              {i + 1 < idx || state === 'READY' ? <span className="text-[var(--sw-pass)]">✓</span> : i + 1 === idx ? <Spinner small label={t.forge.phases[ph] ?? ph} /> : <span className="text-[var(--sw-text-muted)]">○</span>}
              <span className={i + 1 <= idx ? 'text-[var(--sw-text)]' : 'text-[var(--sw-text-muted)]'}>{t.forge.phases[ph]}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function NewForgePage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}
