'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from '@sw/ui';
import type { ViewerHit } from '@sw/ui';
import { api, followJob, type ApiError, type Job } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

export interface Feature {
  key: string;
  part: string | null;
  params: string[];
  bbox_mm: { min: number[]; max: number[] } | null;
}

interface Edit {
  id: string;
  status: 'PROPOSING' | 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'EXPIRED';
  credits: number;
  notes: string[];
  error: string | null;
  target_feature_key: string | null;
  diff: {
    params: { key: string; label: string; from: unknown; to: unknown }[];
    features: { key: string; change: string; lines: { op: '-' | '+'; text: string }[] }[];
    bbox: { from: number[] | null; to: number[] };
  } | null;
  preview: { bbox_mm: number[]; checks_failing: boolean } | null;
}

export interface CopilotPanelProps {
  forgeId: string;
  versionId?: string | undefined;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  /** The latest viewer selection; each new array is resolved once. */
  hits: ViewerHit[] | null;
  onTarget: (key: string | null) => void;
}

const nice = (key: string) => key.replace(/_/g, ' ');
const mm = (b: number[] | null) => (b ? `${b.map((n) => n.toFixed(1)).join(' × ')} mm` : '—');

function waitFor(jobId: string): Promise<Job> {
  return new Promise((resolve) => {
    const stop = followJob(jobId, (j) => {
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
        stop();
        resolve(j);
      }
    });
  });
}

/** Design copilot (Module 6): select a feature, describe a change, review, accept or reject. */
export function CopilotPanel(p: CopilotPanelProps) {
  const router = useRouter();
  const { refresh } = useSession();
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [featured, setFeatured] = useState(true);
  const [cost, setCost] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ key: string; share: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'propose' | 'accept' | 'reject' | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);

  useEffect(() => {
    const q = p.versionId ? `?version=${p.versionId}` : '';
    api<{ featured: boolean; edit_cost: number; data: Feature[] }>(`/v1/forges/${p.forgeId}/features${q}`)
      .then((r) => {
        setFeatures(r.data);
        setFeatured(r.featured);
        setCost(r.edit_cost);
      })
      .catch(() => setFeatures([]));
  }, [p.forgeId, p.versionId]);

  const choose = (key: string | null) => {
    setTarget(key);
    setCandidates(null);
    p.onTarget(key);
  };

  const { hits, forgeId, versionId } = p;
  useEffect(() => {
    if (!hits) return;
    setError(null);
    if (hits.length === 0) {
      setError(t.copilot.missed);
      return;
    }
    api<{ target_feature_key: string }>(`/v1/forges/${forgeId}/region-edits`, { method: 'POST', body: { hits, ...(versionId ? { version_id: versionId } : {}) } })
      .then((r) => choose(r.target_feature_key))
      .catch((e: ApiError) => {
        if (e.code === 'FEATURE_AMBIGUOUS') {
          setCandidates((e.details.candidates as { key: string; share: number }[]) ?? []);
          setTarget(null);
          p.onTarget(null);
        } else setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, forgeId, versionId]);

  async function propose() {
    setBusy('propose');
    setError(null);
    setEdit(null);
    try {
      const r = await api<{ edit: Edit; job: Job }>(`/v1/forges/${forgeId}/copilot-edits`, {
        method: 'POST',
        idempotent: true,
        body: { message, ...(target ? { target_feature_key: target } : {}), ...(versionId ? { version_id: versionId } : {}) },
      });
      void refresh();
      await waitFor(r.job.id);
      setEdit(await api<Edit>(`/v1/copilot-edits/${r.edit.id}`));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(kind: 'accept' | 'reject') {
    if (!edit) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'reject') {
        const r = await api<{ edit: Edit }>(`/v1/copilot-edits/${edit.id}/reject`, { method: 'POST' });
        setEdit(r.edit);
      } else {
        const r = await api<{ job: Job }>(`/v1/copilot-edits/${edit.id}/accept`, { method: 'POST', idempotent: true });
        const done = await waitFor(r.job.id);
        if (done.status !== 'SUCCEEDED') throw new Error(done.error?.message ?? t.common.error);
        router.push(`/forge/${forgeId}?version=${done.output?.version_id}`);
        router.refresh();
      }
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!features) return null;
  const current = features.find((f) => f.key === target) ?? null;
  return (
    <section aria-labelledby="copilot-h" className="space-y-3 rounded-md border border-[var(--sw-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="copilot-h" className="text-sm font-semibold text-[var(--sw-text)]">
          {t.copilot.title}
        </h2>
        {featured ? (
          <Button size="sm" variant={p.selectMode ? 'primary' : 'secondary'} aria-pressed={p.selectMode} onClick={() => p.onSelectMode(!p.selectMode)} data-testid="select-area">
            {p.selectMode ? t.copilot.selecting : t.copilot.selectArea}
          </Button>
        ) : null}
      </div>
      {!featured ? (
        <p className="text-sm text-[var(--sw-text-muted)]" data-testid="not-featured">
          {t.copilot.notFeatured}
        </p>
      ) : (
        <>
          {p.selectMode ? <p className="text-xs text-[var(--sw-text-muted)]">{t.copilot.selectHelp}</p> : null}
          <label className="block space-y-1 text-sm text-[var(--sw-text)]">
            <span className="font-medium">{t.copilot.orPick}</span>
            <select value={target ?? ''} onChange={(e) => choose(e.target.value || null)} className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2" data-testid="feature-select">
              <option value="">{t.copilot.wholePart}</option>
              {features.map((f) => (
                <option key={f.key} value={f.key}>
                  {nice(f.key)}
                </option>
              ))}
            </select>
          </label>
          {candidates ? (
            <div role="group" aria-label={t.copilot.whichOne} className="space-y-1" data-testid="feature-candidates">
              <p className="text-sm text-[var(--sw-text)]">{t.copilot.whichOne}</p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <Button key={c.key} size="sm" variant="secondary" onClick={() => choose(c.key)} data-testid={`candidate-${c.key}`}>
                    {nice(c.key)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {current ? (
            <p className="text-sm text-[var(--sw-text)]" data-testid="feature-target">
              {t.copilot.selected(nice(current.key))}
              {current.params.length ? <span className="text-[var(--sw-text-muted)]"> — {t.copilot.uses(current.params.join(', '))}</span> : null}
            </p>
          ) : null}
        </>
      )}
      <label className="block space-y-1 text-sm text-[var(--sw-text)]">
        <span className="font-medium">{current ? t.copilot.describeFeature(nice(current.key)) : t.copilot.describe}</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={500} placeholder={t.copilot.placeholder} className="w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 py-1" data-testid="copilot-message" />
      </label>
      <Button size="sm" onClick={propose} loading={busy === 'propose'} disabled={message.trim().length < 3 || busy !== null} data-testid="copilot-propose">
        {t.copilot.propose}
      </Button>
      <p className="text-xs text-[var(--sw-text-muted)]">{t.copilot.costNote(cost)}</p>
      {edit ? (
        <div className="space-y-2 rounded border border-[var(--sw-border)] p-2" data-testid="copilot-proposal">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--sw-text)]">{t.copilot.proposal}</span>
            <Badge tone={edit.status === 'PROPOSED' ? 'accent' : edit.status === 'FAILED' ? 'fail' : 'neutral'}>{t.copilot.status[edit.status]}</Badge>
          </div>
          {edit.error ? <p className="text-sm text-[var(--sw-fail)]">{edit.error}</p> : null}
          {edit.notes.map((n) => (
            <p key={n} className="text-xs text-[var(--sw-text-muted)]">
              {n}
            </p>
          ))}
          {edit.diff ? (
            <ul className="space-y-1 text-sm text-[var(--sw-text)]" data-testid="copilot-diff">
              {edit.diff.params.map((d) => (
                <li key={d.key}>
                  {d.label}: <span className="font-mono">{String(d.from)}</span> → <span className="font-mono">{String(d.to)}</span>
                </li>
              ))}
              {edit.diff.features.map((f) => (
                <li key={f.key}>
                  {t.copilot.featureChange(nice(f.key), f.change)}
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--sw-surface)] p-1 font-mono text-xs">
                    {f.lines.map((l, i) => (
                      <span key={i} className={l.op === '+' ? 'block text-[var(--sw-pass)]' : 'block text-[var(--sw-fail)]'}>
                        {l.op} {l.text}
                      </span>
                    ))}
                  </pre>
                </li>
              ))}
              <li className="text-xs text-[var(--sw-text-muted)]">{t.copilot.size(mm(edit.diff.bbox.from), mm(edit.diff.bbox.to))}</li>
              {edit.preview?.checks_failing ? <li className="text-xs text-[var(--sw-warn)]">{t.copilot.checksFail}</li> : null}
            </ul>
          ) : null}
          {edit.status === 'PROPOSED' ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide('accept')} loading={busy === 'accept'} disabled={busy !== null} data-testid="copilot-accept">
                {t.copilot.accept(edit.credits)}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => decide('reject')} loading={busy === 'reject'} disabled={busy !== null} data-testid="copilot-reject">
                {t.copilot.reject}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <Alert tone="fail" title={error} /> : null}
    </section>
  );
}
