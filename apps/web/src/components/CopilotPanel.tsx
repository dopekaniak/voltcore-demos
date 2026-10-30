'use client';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@sw/ui';
import type { ViewerHit } from '@sw/ui';
import { api, type ApiError } from '@/lib/api';
import { t } from '@/lib/messages';

export interface Feature {
  key: string;
  part: string | null;
  params: string[];
  bbox_mm: { min: number[]; max: number[] } | null;
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

/** Region selection: map an area of the model to one named feature (Module 6). */
export function CopilotPanel(p: CopilotPanelProps) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [featured, setFeatured] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ key: string; share: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = p.versionId ? `?version=${p.versionId}` : '';
    api<{ featured: boolean; data: Feature[] }>(`/v1/forges/${p.forgeId}/features${q}`)
      .then((r) => {
        setFeatures(r.data);
        setFeatured(r.featured);
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

  if (!features) return null;
  if (!featured)
    return (
      <section aria-labelledby="copilot-h" className="space-y-2 rounded-md border border-[var(--sw-border)] p-3">
        <h2 id="copilot-h" className="text-sm font-semibold text-[var(--sw-text)]">
          {t.copilot.title}
        </h2>
        <p className="text-sm text-[var(--sw-text-muted)]" data-testid="not-featured">
          {t.copilot.notFeatured}
        </p>
      </section>
    );

  const current = features.find((f) => f.key === target) ?? null;
  return (
    <section aria-labelledby="copilot-h" className="space-y-3 rounded-md border border-[var(--sw-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="copilot-h" className="text-sm font-semibold text-[var(--sw-text)]">
          {t.copilot.title}
        </h2>
        <Button size="sm" variant={p.selectMode ? 'primary' : 'secondary'} aria-pressed={p.selectMode} onClick={() => p.onSelectMode(!p.selectMode)} data-testid="select-area">
          {p.selectMode ? t.copilot.selecting : t.copilot.selectArea}
        </Button>
      </div>
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
      {error ? <Alert tone="fail" title={error} /> : null}
    </section>
  );
}
