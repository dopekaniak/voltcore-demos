'use client';
import type { ParamSchema, ParamSpec, ParamValues } from '@sw/forge-kit/browser';
import { t } from '@/lib/messages';

function NumberControl({ k, spec, value, onChange }: { k: string; spec: Extract<ParamSpec, { type: 'number' }>; value: number; onChange: (v: unknown) => void }) {
  const id = `p-${k}`;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-[var(--sw-text)]">
          {spec.label}
        </label>
        <span className="flex items-center gap-1">
          <input
            aria-label={`${spec.label} value`}
            type="number"
            inputMode="decimal"
            step={spec.step}
            value={Number.isFinite(value) ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? spec.default : Number(e.target.value))}
            className="h-7 w-20 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1.5 text-right font-mono text-xs tabular-nums text-[var(--sw-text)]"
            data-testid={`param-input-${k}`}
          />
          {spec.unit ? <span className="w-6 text-xs text-[var(--sw-text-muted)]">{spec.unit}</span> : null}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Math.min(spec.max, Math.max(spec.min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--sw-accent)]"
        aria-describedby={spec.description ? `${id}-d` : undefined}
        data-testid={`param-slider-${k}`}
      />
      {spec.description ? (
        <p id={`${id}-d`} className="text-xs text-[var(--sw-text-muted)]">
          {spec.description}
        </p>
      ) : null}
    </div>
  );
}

export function ParamPanel({ schema, values, onChange, clampNotes }: { schema: ParamSchema; values: ParamValues; onChange: (key: string, v: unknown) => void; clampNotes: string[] }) {
  const sections = new Map<string, [string, ParamSpec][]>();
  for (const [k, s] of Object.entries(schema)) {
    if (s.hidden) continue;
    const sec = s.section ?? t.forge.parameters;
    sections.set(sec, [...(sections.get(sec) ?? []), [k, s]]);
  }
  return (
    <section aria-labelledby="params-h" className="space-y-4">
      <h2 id="params-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
        {t.forge.parameters}
      </h2>
      {clampNotes.length ? (
        <div role="status" className="rounded border border-[var(--sw-warn)] bg-[var(--sw-surface)] p-2 text-xs text-[var(--sw-text)]" data-testid="clamp-notes">
          <p className="font-semibold">{t.forge.clamped}</p>
          <ul className="list-disc pl-4">
            {clampNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {[...sections.entries()].map(([title, entries]) => (
        <fieldset key={title} className="space-y-3 rounded-md border border-[var(--sw-border)] p-3">
          <legend className="px-1 text-sm font-semibold text-[var(--sw-text)]">{title}</legend>
          {entries.map(([k, s]) => {
            const v = values[k];
            if (s.type === 'number') return <NumberControl key={k} k={k} spec={s} value={Number(v)} onChange={(x) => onChange(k, x)} />;
            if (s.type === 'boolean')
              return (
                <label key={k} className="flex items-center gap-2 text-sm text-[var(--sw-text)]">
                  <input type="checkbox" checked={Boolean(v)} onChange={(e) => onChange(k, e.target.checked)} className="h-4 w-4 accent-[var(--sw-accent)]" data-testid={`param-toggle-${k}`} />
                  {s.label}
                </label>
              );
            if (s.type === 'enum')
              return (
                <label key={k} className="block space-y-1 text-sm text-[var(--sw-text)]">
                  <span className="font-medium">{s.label}</span>
                  <select value={String(v)} onChange={(e) => onChange(k, s.options.find((o) => String(o.value) === e.target.value)?.value)} className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2">
                    {s.options.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            return (
              <label key={k} className="block space-y-1 text-sm text-[var(--sw-text)]">
                <span className="font-medium">{s.label}</span>
                <input value={String(v ?? '')} maxLength={s.maxLength} onChange={(e) => onChange(k, e.target.value)} className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2" data-testid={`param-text-${k}`} />
              </label>
            );
          })}
        </fieldset>
      ))}
    </section>
  );
}
