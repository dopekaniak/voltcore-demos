'use client';
import { useEffect, useState } from 'react';
import { Alert } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import type { Printer } from './ForgeWorkbench';

/** Printer profile picker: drives bed fit, wall minimum, and overhang checks. */
export function PrinterPanel({ forgeId, printer, onChange }: { forgeId: string; printer: Printer; onChange: (p: Printer) => void }) {
  const [profiles, setProfiles] = useState<Printer[]>([]);
  const [bed, setBed] = useState<number[]>(printer.bed_mm);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: Printer[] }>('/v1/printer-profiles').then((r) => setProfiles(r.data)).catch(() => undefined);
  }, []);

  async function save(profileId: string, bedMm?: number[]) {
    setError(null);
    try {
      const r = await api<{ printer: Printer }>(`/v1/forges/${forgeId}/printer-profile`, { method: 'PUT', body: { profile_id: profileId, ...(bedMm ? { bed_mm: bedMm } : {}) } });
      onChange(r.printer);
      setBed(r.printer.bed_mm);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section aria-labelledby="printer-h" className="space-y-2 rounded-md border border-[var(--sw-border)] p-3">
      <h2 id="printer-h" className="text-sm font-semibold text-[var(--sw-text)]">
        {t.printer.title}
      </h2>
      <select value={printer.id} onChange={(e) => void save(e.target.value)} aria-label={t.printer.title} className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-sm" data-testid="printer-select">
        {(profiles.length ? profiles : [printer]).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {printer.is_generic ? (
        <fieldset className="flex items-end gap-1 text-xs text-[var(--sw-text)]">
          <legend className="mb-1 text-xs text-[var(--sw-text-muted)]">{t.printer.bed}</legend>
          {['X', 'Y', 'Z'].map((axis, i) => (
            <label key={axis} className="flex flex-col">
              {axis}
              <input
                type="number"
                min={20}
                max={2000}
                value={bed[i] ?? ''}
                onChange={(e) => setBed((b) => b.map((v, j) => (j === i ? Number(e.target.value) : v)))}
                onBlur={() => void save(printer.id, bed)}
                className="h-8 w-16 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1 text-right font-mono"
                data-testid={`bed-${axis.toLowerCase()}`}
              />
            </label>
          ))}
          <span className="pb-1 text-[var(--sw-text-muted)]">mm</span>
        </fieldset>
      ) : (
        <p className="text-xs text-[var(--sw-text-muted)]">{t.printer.summary(printer.bed_mm.join(' × '), printer.nozzle_mm)}</p>
      )}
      {error ? <Alert tone="fail" title={error} /> : null}
    </section>
  );
}
