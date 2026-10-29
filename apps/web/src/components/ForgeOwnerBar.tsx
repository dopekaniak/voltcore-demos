'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ParamValues } from '@sw/forge-kit/browser';
import { Alert, Button } from '@sw/ui';
import { api, followJob, type Job } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

export interface VersionInfo {
  id: string;
  number: number;
}

async function waitFor(jobId: string): Promise<Job> {
  return new Promise((resolve) => {
    const stop = followJob(jobId, (j) => {
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
        stop();
        resolve(j);
      }
    });
  });
}

/** Versions, visibility, save-as-version, and fork controls above the workbench. */
export function ForgeOwnerBar(p: { forgeId: string; isOwner: boolean; visibility: string; versions: VersionInfo[]; currentVersionId: string; forkedFrom: string | null; params: ParamValues | null; dirty: boolean }) {
  const router = useRouter();
  const { me } = useSession();
  const [visibility, setVisibility] = useState(p.visibility);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'save' | 'fork') {
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/forge/${p.forgeId}`)}`);
    setBusy(kind);
    setError(null);
    try {
      const path = kind === 'save' ? `/v1/forges/${p.forgeId}/versions` : `/v1/forges/${p.forgeId}/fork`;
      const { job } = await api<{ job: Job }>(path, { method: 'POST', body: { params: p.params ?? {}, version_id: p.currentVersionId }, idempotent: true });
      const done = await waitFor(job.id);
      if (done.status !== 'SUCCEEDED') throw new Error(done.error?.message ?? t.common.error);
      const forge = done.output?.forge_id as string;
      router.push(kind === 'save' ? `/forge/${forge}?version=${done.output?.version_id}` : `/forge/${forge}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-[var(--sw-border)] p-3 text-sm">
      <label className="space-y-1">
        <span className="block text-xs font-medium text-[var(--sw-text-muted)]">{t.forge.versions}</span>
        <select value={p.currentVersionId} onChange={(e) => router.push(`/forge/${p.forgeId}?version=${e.target.value}`)} className="h-9 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2" data-testid="version-select">
          {p.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {t.forge.version(v.number)}
            </option>
          ))}
        </select>
      </label>
      {p.isOwner ? (
        <>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-[var(--sw-text-muted)]">{t.forge.visibility}</span>
            <select
              value={visibility}
              onChange={async (e) => {
                const v = e.target.value;
                setVisibility(v);
                await api(`/v1/assets/${p.forgeId}`, { method: 'PATCH', body: { visibility: v } }).catch((err: Error) => setError(err.message));
              }}
              className="h-9 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2"
              data-testid="visibility-select"
            >
              {['PRIVATE', 'UNLISTED', 'PUBLIC'].map((v) => (
                <option key={v} value={v}>
                  {t.forge.visibilityOptions[v]}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => run('save')} loading={busy === 'save'} disabled={!p.dirty || busy !== null} data-testid="save-version">
            {t.forge.saveVersion}
          </Button>
        </>
      ) : (
        <p className="text-[var(--sw-text-muted)]">{t.forge.notOwner}</p>
      )}
      <Button variant="secondary" onClick={() => run('fork')} loading={busy === 'fork'} disabled={busy !== null} title={t.forge.forkHelp} data-testid="fork">
        {t.forge.fork}
      </Button>
      {p.forkedFrom ? (
        <span className="text-xs text-[var(--sw-text-muted)]">
          {t.forge.forkedFrom}{' '}
          <Link href={`/forge/${p.forkedFrom}`} className="underline">
            {p.forkedFrom.slice(0, 12)}…
          </Link>
        </span>
      ) : null}
      {error ? <div className="w-full"><Alert tone="fail" title={error} /></div> : null}
    </div>
  );
}
