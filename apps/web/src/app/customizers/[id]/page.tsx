'use client';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clampMessage, injectRelief, toPartParams, validateCustomizerInputs, validateParams, type InputRule, type ParamSchema, type ParamValues, type ReliefGrid } from '@sw/forge-kit/browser';
import { Alert, Badge, Button, Spinner } from '@sw/ui';
import type { ViewerMesh } from '@sw/ui';
import { ParamPanel } from '@/components/ParamPanel';
import { api, ApiError, downloadBytes, followJob, type Job } from '@/lib/api';
import { useForgeRuntime } from '@/lib/forge-runtime';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-[var(--sw-viewer-bg)]" /> });

interface Detail {
  id: string;
  key: string;
  title: string;
  description: string;
  takes_image: boolean;
  license: { code: string; name: string; attribution: string } | null;
  code: string;
  schema: ParamSchema;
  input_rules: Record<string, InputRule>;
  export: { cost: number; free_remaining: number; formats: string[]; footer: string | null };
}

export default function CustomizerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, refresh } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [grid, setGrid] = useState<ReliefGrid | null>(null);
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [imagePhase, setImagePhase] = useState<string | null>(null);
  const [values, setValues] = useState<ParamValues | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [meshes, setMeshes] = useState<ViewerMesh[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useMemo(() => () => api<Detail>(`/v1/customizers/${id}`).then(setDetail), [id]);
  useEffect(() => {
    load().catch(() => setMissing(true));
  }, [load, me?.id]);

  // The relief height map is data substituted into the customizer, never code.
  const code = useMemo(() => (detail ? injectRelief(detail.code, grid) : null), [detail, grid]);
  const runtime = useForgeRuntime(code);
  const schema = detail?.schema ?? null;

  useEffect(() => {
    if (schema && !values) setValues(validateParams(schema, {}).values);
  }, [schema, values]);

  // Previews build in the browser and are free; rebuild 250 ms after the last change.
  useEffect(() => {
    if (!schema || !values || runtime.status !== 'ready' || invalid.length) return;
    const my = ++seq.current;
    setBusy(true);
    const handle = setTimeout(async () => {
      try {
        const b = await runtime.build(toPartParams(schema, values));
        if (my !== seq.current) return;
        if (!b.superseded) setMeshes(b.meshes);
        setBuildError(null);
      } catch (e) {
        if (my === seq.current) setBuildError((e as Error).message);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, values, runtime.status, runtime.generation, invalid.length]);

  function onParam(key: string, raw: unknown) {
    if (!schema || !detail) return;
    const next = { ...(values ?? {}), [key]: raw };
    const v = validateCustomizerInputs(schema, detail.input_rules, next);
    setInvalid(v.invalid.map((i) => i.message));
    setNotes(v.clamped.filter((c) => c.key === key).map((c) => clampMessage(c, schema[c.key])));
    // Keep the typed text visible while it is invalid so the person can fix it.
    setValues(v.invalid.length ? { ...v.values, [key]: raw as string } : v.values);
  }

  async function onImage(file: File) {
    if (!detail) return;
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/customizers/${detail.key}`)}`);
    setNotice(null);
    try {
      setImagePhase(t.customizers.uploading);
      const type = file.type || 'image/png';
      const c = await api<{ upload: { id: string }; put: { url: string; headers: Record<string, string> } }>('/v1/uploads', { method: 'POST', body: { filename: file.name, content_type: type, bytes: file.size, purpose: 'image' } });
      const put = await fetch(c.put.url, { method: 'PUT', headers: c.put.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await api(`/v1/uploads/${c.upload.id}/complete`, { method: 'POST' });
      setImagePhase(t.customizers.reading);
      const g = await api<ReliefGrid>(`/v1/customizers/${detail.id}/relief`, { method: 'POST', body: { upload_id: c.upload.id } });
      setGrid(g);
      setImageUpload(c.upload.id);
    } catch (e) {
      setNotice({ tone: 'fail', text: (e as Error).message });
    } finally {
      setImagePhase(null);
    }
  }

  async function exportFile(format: 'stl' | '3mf') {
    if (!detail || !values) return;
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/customizers/${detail.key}`)}`);
    setExporting(format);
    setNotice(null);
    try {
      const r = await api<{ job: Job }>(`/v1/customizers/${detail.id}/exports`, { method: 'POST', idempotent: true, body: { inputs: values, format, ...(imageUpload ? { image_upload_id: imageUpload } : {}) } });
      const done = await new Promise<Job>((resolve) => {
        const stop = followJob(r.job.id, (j) => {
          if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
            stop();
            resolve(j);
          }
        });
      });
      if (done.status !== 'SUCCEEDED') throw new Error(done.error?.message ?? t.common.error);
      const f = await api<{ url: string; filename: string }>(`/v1/jobs/${done.id}/file`);
      const res = await fetch(f.url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      downloadBytes(await res.arrayBuffer(), f.filename, format === 'stl' ? 'model/stl' : 'model/3mf');
      setNotice({ tone: 'pass', text: t.customizers.exported });
      void refresh();
      void load();
    } catch (e) {
      setNotice({ tone: 'fail', text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setExporting(null);
    }
  }

  if (missing) return <Alert tone="fail" title={t.errors.notFound}>{t.errors.notFoundLead}</Alert>;
  if (!detail || !schema)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  const a = detail.export;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--sw-text)]">{detail.title}</h1>
          <Badge tone="accent">{t.customizers.badge}</Badge>
          {detail.license ? <Badge>{detail.license.code}</Badge> : null}
        </div>
        <p className="text-sm text-[var(--sw-text-muted)]">{detail.description}</p>
        <ModelViewer meshes={meshes} busy={busy && meshes !== undefined} className="h-[52vh] min-h-[320px]" label={`${detail.title} preview`} />
        {runtime.status === 'starting' ? <p className="text-sm text-[var(--sw-text-muted)]">{t.forge.runtimeLoading}</p> : null}
        {runtime.status === 'error' ? <Alert tone="fail" title={t.forge.buildError}>{runtime.error}</Alert> : null}
        {buildError ? <Alert tone="fail" title={t.forge.buildError}>{buildError}</Alert> : null}
        <section aria-labelledby="cz-export-h" className="space-y-2">
          <h2 id="cz-export-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
            {t.forge.exports}
          </h2>
          <p className="text-sm text-[var(--sw-text)]" data-testid="export-allowance">
            {me ? (a.free_remaining > 0 ? t.customizers.freeLeft(a.free_remaining) : t.customizers.costs(a.cost)) : t.customizers.signInToExport}
          </p>
          <div className="flex flex-wrap gap-2">
            {(['stl', '3mf'] as const).map((f) => (
              <Button key={f} variant="secondary" onClick={() => exportFile(f)} loading={exporting === f} disabled={!meshes || exporting !== null || invalid.length > 0 || (me !== null && !a.formats.includes(f))} data-testid={`cz-export-${f}`}>
                {f === 'stl' ? t.forge.exportStl : t.forge.export3mf}
              </Button>
            ))}
          </div>
          {me && !a.formats.includes('3mf') ? <p className="text-xs text-[var(--sw-text-muted)]">{t.customizers.paidFormats}</p> : null}
          {notice ? <Alert tone={notice.tone} title={notice.text} /> : null}
          {a.footer ? (
            <p className="text-xs text-[var(--sw-text-muted)]" data-testid="export-footer">
              {a.footer}
            </p>
          ) : null}
          {detail.license ? <p className="text-xs text-[var(--sw-text-muted)]">{detail.license.attribution}</p> : null}
        </section>
      </div>
      <aside className="space-y-6">
        {detail.takes_image ? (
          <div className="space-y-2 rounded-md border border-[var(--sw-border)] p-3">
            <label htmlFor="cz-image" className="block text-sm font-semibold text-[var(--sw-text)]">
              {t.customizers.image}
            </label>
            <input id="cz-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void onImage(e.target.files[0])} className="block w-full text-sm" disabled={imagePhase !== null} />
            <p className="text-xs text-[var(--sw-text-muted)]">{t.customizers.imagePolicy}</p>
            {imagePhase ? (
              <p className="flex items-center gap-2 text-sm text-[var(--sw-text-muted)]">
                <Spinner /> {imagePhase}
              </p>
            ) : null}
          </div>
        ) : null}
        {values ? <ParamPanel schema={schema} values={values} onChange={onParam} clampNotes={notes} /> : null}
        {invalid.length ? (
          <Alert tone="fail" title={t.customizers.fixInputs}>
            {invalid.join(' ')}
          </Alert>
        ) : null}
      </aside>
    </div>
  );
}
