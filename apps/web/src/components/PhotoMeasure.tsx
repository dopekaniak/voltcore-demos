'use client';
import { useEffect, useRef, useState } from 'react';
import { mmKeys, type Dimensions, type ParamSchema } from '@sw/forge-kit/browser';
import { Alert, Button } from '@sw/ui';
import { api, followJob, type Job } from '@/lib/api';
import { t } from '@/lib/messages';

type Pt = [number, number];
interface Calibration {
  id: string;
  real_length_mm: number;
  mm_per_px: number;
  image: { width: number; height: number };
}

/**
 * Measure from a photo (Module 6, section 3): draw a line across an edge you know and enter
 * its length (calibration), then draw lines across what you want to size. Without a
 * calibration nothing is measured; the scale is never guessed from the picture.
 */
export function PhotoMeasure(p: { forgeId: string; versionId?: string | undefined; schema: ParamSchema; dimensions: Dimensions; onSaved: (versionId: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ url: string; uploadId: string } | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [length, setLength] = useState('');
  const [cal, setCal] = useState<Calibration | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail' | 'info'; text: string } | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const keys = mmKeys(p.schema);

  useEffect(() => {
    api<{ photo_calibration: boolean }>(`/v1/forges/${p.forgeId}/features`).then((r) => setEnabled(r.photo_calibration)).catch(() => undefined);
  }, [p.forgeId]);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);
  if (!enabled) return null;

  async function onFile(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const c = await api<{ upload: { id: string }; put: { url: string; headers: Record<string, string> } }>('/v1/uploads', { method: 'POST', body: { filename: file.name, content_type: file.type || 'image/jpeg', bytes: file.size, purpose: 'image' } });
      const put = await fetch(c.put.url, { method: 'PUT', headers: c.put.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await api(`/v1/uploads/${c.upload.id}/complete`, { method: 'POST' });
      setPhoto({ url: URL.createObjectURL(file), uploadId: c.upload.id });
      setPoints([]);
      setCal(null);
    } catch (e) {
      setMsg({ tone: 'fail', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const el = img.current!;
    const r = el.getBoundingClientRect();
    const pt: Pt = [Math.round(((e.clientX - r.left) / r.width) * el.naturalWidth), Math.round(((e.clientY - r.top) / r.height) * el.naturalHeight)];
    setPoints((ps) => (ps.length >= 2 ? [pt] : [...ps, pt]));
  };

  async function calibrate() {
    if (!photo || points.length !== 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const c = await api<Calibration>('/v1/calibrations', { method: 'POST', body: { photo_upload_id: photo.uploadId, line_px: points, real_length_mm: Number(length) } });
      setCal(c);
      setPoints([]);
      setMsg({ tone: 'pass', text: t.photo.calibrated(c.real_length_mm) });
    } catch (e) {
      setMsg({ tone: 'fail', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function measure() {
    if (points.length !== 2 || !key) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ value_mm: number; job: Job }>(`/v1/forges/${p.forgeId}/measurements`, {
        method: 'POST',
        idempotent: true,
        body: { key, line_px: points, ...(cal ? { calibration_id: cal.id } : {}), ...(p.versionId ? { version_id: p.versionId } : {}) },
      });
      setMsg({ tone: 'info', text: t.photo.measured(p.schema[key]?.label ?? key, r.value_mm) });
      const done = await new Promise<Job>((resolve) => {
        const stop = followJob(r.job.id, (j) => {
          if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
            stop();
            resolve(j);
          }
        });
      });
      if (done.status !== 'SUCCEEDED') throw new Error(done.error?.message ?? t.common.error);
      p.onSaved(String(done.output?.version_id));
    } catch (e) {
      setMsg({ tone: 'fail', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const line = points.length === 2 && img.current ? points : null;
  return (
    <section aria-labelledby="photo-h" className="space-y-2 rounded-md border border-[var(--sw-border)] p-3">
      <div className="flex items-center justify-between">
        <h2 id="photo-h" className="text-sm font-semibold text-[var(--sw-text)]">
          {t.photo.title}
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t.common.close : t.photo.open}
        </Button>
      </div>
      {open ? (
        <>
          <p className="text-xs text-[var(--sw-text-muted)]">{t.photo.lead}</p>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} className="block w-full text-sm" aria-label={t.photo.choose} />
          {photo ? (
            <div className="relative">
              <img ref={img} src={photo.url} alt={t.photo.alt} onClick={onClick} className="w-full cursor-crosshair rounded" />
              {line && img.current ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${img.current.naturalWidth} ${img.current.naturalHeight}`} preserveAspectRatio="none" aria-hidden="true">
                  <line x1={line[0]![0]} y1={line[0]![1]} x2={line[1]![0]} y2={line[1]![1]} stroke="#2563eb" strokeWidth={Math.max(2, img.current.naturalWidth / 200)} />
                </svg>
              ) : null}
            </div>
          ) : null}
          {photo ? <p className="text-xs text-[var(--sw-text-muted)]">{points.length < 2 ? t.photo.clickTwice : t.photo.line(points)}</p> : null}
          {photo && !cal ? (
            <div className="flex items-end gap-2">
              <label className="text-sm text-[var(--sw-text)]">
                {t.photo.knownLength}
                <input type="number" min={0} step={0.1} value={length} onChange={(e) => setLength(e.target.value)} className="ml-1 h-8 w-20 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1" />
              </label>
              <Button size="sm" onClick={calibrate} disabled={points.length !== 2 || !(Number(length) > 0) || busy}>
                {t.photo.calibrate}
              </Button>
            </div>
          ) : null}
          {photo ? (
            <div className="flex items-end gap-2">
              <label className="text-sm text-[var(--sw-text)]">
                {t.photo.size}
                <select value={key} onChange={(e) => setKey(e.target.value)} className="ml-1 h-8 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-1">
                  <option value="">—</option>
                  {keys.map((k) => (
                    <option key={k} value={k}>
                      {p.schema[k]?.label ?? k}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" onClick={measure} disabled={points.length !== 2 || !key || busy}>
                {t.photo.apply}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {msg ? <Alert tone={msg.tone} title={msg.text} /> : null}
    </section>
  );
}
