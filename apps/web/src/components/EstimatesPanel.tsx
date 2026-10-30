'use client';
import { useMemo, useState } from 'react';
import { baseFootprint, bendingEstimate, ESTIMATE_LABEL, MATERIAL_STRENGTH_MPA, tipOverEstimate, type Estimate, type ForgeReport } from '@sw/forge-kit/browser';
import type { ViewerMesh } from '@sw/ui';
import { t } from '@/lib/messages';
import type { Feature } from './CopilotPanel';

function EstimateCard({ e }: { e: Estimate }) {
  return (
    <div className="space-y-1 rounded border border-[var(--sw-border)] p-2 text-sm" data-testid="estimate">
      <p className="font-medium text-[var(--sw-text)]">
        {e.title}: <span className="font-mono">{e.value} {e.unit}</span>
      </p>
      <p className="text-[var(--sw-text)]">{e.summary}</p>
      <p className="font-mono text-xs text-[var(--sw-text-muted)]">
        {e.formula} — {Object.entries(e.inputs).map(([k, v]) => `${k} = ${v}`).join(', ')}
      </p>
      <ul className="list-disc pl-4 text-xs text-[var(--sw-text-muted)]">
        {e.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <p className="text-xs font-semibold text-[var(--sw-warn)]" data-testid="estimate-label">
        {e.label}
      </p>
    </div>
  );
}

/** Engineering estimates (Module 6): tip-over and bending, always labeled as estimates. */
export function EstimatesPanel({ report, meshes, features }: { report: ForgeReport | null; meshes: ViewerMesh[] | undefined; features: Feature[] }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState('');
  const [load, setLoad] = useState(10);
  const [material, setMaterial] = useState('PLA');
  const tip = useMemo(() => {
    const sub = report?.subparts.length === 1 ? report.subparts[0] : null;
    const pos = meshes?.length === 1 ? meshes[0]!.positions : null;
    if (!sub?.centerOfMass || !pos) return null;
    return tipOverEstimate({ centerOfMass: sub.centerOfMass, footprint: baseFootprint(pos), bedZ: sub.bounds?.min[2] ?? 0 });
  }, [report, meshes]);
  const f = features.find((x) => x.key === feature);
  const bend = f?.bbox_mm && load > 0 ? bendingEstimate({ feature: f.key, size: f.bbox_mm.max.map((v, i) => v - f.bbox_mm!.min[i]!), loadN: load, material }) : null;
  return (
    <section aria-labelledby="est-h" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id="est-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
          {t.estimates.title}
        </h2>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs text-[var(--sw-accent)] underline" data-testid="estimates-toggle">
          {open ? t.common.close : t.estimates.open}
        </button>
      </div>
      {open ? (
        <>
          <p className="text-xs font-semibold text-[var(--sw-warn)]">{ESTIMATE_LABEL} {t.estimates.never}</p>
          {tip ? <EstimateCard e={tip} /> : <p className="text-xs text-[var(--sw-text-muted)]">{t.estimates.noTip}</p>}
          {features.length ? (
            <div className="space-y-2 rounded border border-[var(--sw-border)] p-2">
              <div className="flex flex-wrap items-end gap-2 text-sm text-[var(--sw-text)]">
                <label className="flex flex-col">
                  {t.estimates.feature}
                  <select value={feature} onChange={(e) => setFeature(e.target.value)} className="h-8 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1" data-testid="bend-feature">
                    <option value="">—</option>
                    {features.filter((x) => x.bbox_mm).map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.key.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col">
                  {t.estimates.load}
                  <input type="number" min={0} step={1} value={load} onChange={(e) => setLoad(Number(e.target.value))} className="h-8 w-20 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1" />
                </label>
                <label className="flex flex-col">
                  {t.estimates.material}
                  <select value={material} onChange={(e) => setMaterial(e.target.value)} className="h-8 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1">
                    {Object.keys(MATERIAL_STRENGTH_MPA).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
              </div>
              {bend ? <EstimateCard e={bend} /> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
