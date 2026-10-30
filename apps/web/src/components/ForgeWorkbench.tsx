'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampMessage, dfmFromPrinter, type ForgeReport, extractSchema, toPartParams, unconfirmedAssumed, validateParams, type Dimensions, type ForgeCheck, type ParamSchema, type ParamValues } from '@sw/forge-kit/browser';
import { Alert, Badge, Button, Dialog } from '@sw/ui';
import type { ViewerHit, ViewerMesh } from '@sw/ui';
import { api, ApiError, downloadBytes, followJob, type Job } from '@/lib/api';
import { downloadFile } from '@/lib/files';
import { useForgeRuntime } from '@/lib/forge-runtime';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { ChecksPanel } from './ChecksPanel';
import { CopilotPanel } from './CopilotPanel';
import { PrinterPanel } from './PrinterPanel';
import { PhotoMeasure } from './PhotoMeasure';
import { EstimatesPanel } from './EstimatesPanel';
import type { Feature } from './CopilotPanel';
import { ParamPanel } from './ParamPanel';

// three.js is heavy; load the viewer only on the client, on demand.
const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-[var(--sw-viewer-bg)]" /> });

export interface Printer {
  id: string;
  key: string;
  name: string;
  bed_mm: number[];
  nozzle_mm: number;
  wall_min_mm: number;
  overhang_deg: number;
  is_generic: boolean;
}

export interface WorkbenchProps {
  title: string;
  code: string;
  schema?: ParamSchema | null;
  initialParams?: ParamValues;
  /** Saved forge (frg_…); absent for starter previews. */
  forgeId?: string;
  assetId?: string;
  versionId?: string;
  versionNumber?: number;
  starterKey?: string;
  stepCost?: number;
  dimensions?: Dimensions;
  printer?: Printer;
  isOwner?: boolean;
  onReload?: () => void;
  /** Rendered above the workbench; receives the current values. */
  header?: (values: ParamValues | null, dirty: boolean) => React.ReactNode;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'forge';

export function ForgeWorkbench(p: WorkbenchProps) {
  const router = useRouter();
  const { me, refresh } = useSession();
  const runtime = useForgeRuntime(p.code);
  const schema = useMemo<ParamSchema | null>(() => {
    if (p.schema && Object.keys(p.schema).length) return p.schema;
    if (!runtime.loaded) return null;
    return extractSchema(runtime.loaded.parameters, runtime.loaded.defaults);
  }, [p.schema, runtime.loaded]);
  const [values, setValues] = useState<ParamValues | null>(null);
  const [clampNotes, setClampNotes] = useState<string[]>([]);
  const [meshes, setMeshes] = useState<ViewerMesh[] | undefined>(undefined);
  const [checks, setChecks] = useState<ForgeCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'pass' | 'fail' | 'info'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const [selectMode, setSelectMode] = useState(false);
  const [hits, setHits] = useState<ViewerHit[] | null>(null);
  const [targetFeature, setTargetFeature] = useState<string | null>(null);
  const [printer, setPrinter] = useState<Printer | null>(p.printer ?? null);
  const [dims, setDims] = useState<Dimensions>(p.dimensions ?? {});
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<ForgeReport | null>(null);
  const [shown, setShown] = useState<{ id: string; location: number[] | null; overhang: boolean } | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => {
    if (!p.forgeId) return;
    api<{ data: Feature[] }>(`/v1/forges/${p.forgeId}/features${p.versionId ? `?version=${p.versionId}` : ''}`).then((r) => setFeatures(r.data)).catch(() => undefined);
  }, [p.forgeId, p.versionId]);
  const dfm = useMemo(() => (printer ? dfmFromPrinter({ key: printer.key, name: printer.name, bed_mm: printer.bed_mm as [number, number, number], wall_min_mm: printer.wall_min_mm, overhang_default_deg: printer.overhang_deg, is_generic: false }) : null), [printer]);

  // Initial values once the schema is known.
  useEffect(() => {
    if (!schema || values) return;
    setValues(validateParams(schema, p.initialParams ?? {}).values);
  }, [schema, values, p.initialParams]);

  // Rebuild 250 ms after the last change; keep the last good mesh while rebuilding.
  useEffect(() => {
    if (!schema || !values || runtime.status !== 'ready') return;
    const my = ++seq.current;
    setBusy(true);
    const handle = setTimeout(async () => {
      const params = toPartParams(schema, values);
      try {
        const [b, report] = await Promise.all([runtime.build(params), runtime.inspect(params, dfm as unknown as Record<string, unknown> | null)]);
        if (my !== seq.current) return;
        if (!b.superseded) setMeshes(b.meshes);
        setChecks(report.checks);
        setReport(report);
        setBuildError(null);
      } catch (e) {
        if (my === seq.current) setBuildError((e as Error).message);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, values, runtime.status, runtime.generation, dfm]);

  const onParam = useCallback(
    (key: string, raw: unknown) => {
      if (!schema) return;
      setValues((prev) => {
        const r = validateParams(schema, { ...(prev ?? {}), [key]: raw });
        setClampNotes(r.clamped.filter((c) => c.key === key).map((c) => clampMessage(c, schema[c.key])));
        return r.values;
      });
      setAck(false);
    },
    [schema],
  );

  const failing = (checks ?? []).filter((c) => c.status === 'fail');
  // Sizes the author assumed must be confirmed (or changed) before any export (Module 6 rule 2).
  const assumed = values ? unconfirmedAssumed(dims, p.initialParams ?? {}, values) : [];
  const canPrint = checks !== null && (failing.length === 0 || ack) && !busy && !buildError && assumed.length === 0;

  async function confirmSizes() {
    if (!p.forgeId) return;
    setConfirming(true);
    try {
      const r = await api<{ dimensions: Dimensions }>(`/v1/forges/${p.forgeId}/dimensions/confirm`, { method: 'POST', body: { ...(p.versionId ? { version_id: p.versionId } : {}) } });
      setDims((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, r.dimensions[k] ? { ...v, ...r.dimensions[k] } : v])));
    } catch (e) {
      setNotice({ tone: 'fail', text: (e as Error).message });
    } finally {
      setConfirming(false);
    }
  }

  async function exportLocal(format: 'stl' | '3mf') {
    if (!schema || !values) return;
    setExporting(format);
    setNotice(null);
    try {
      const parts = await runtime.exportFile(format, toPartParams(schema, values));
      for (const part of parts) {
        const name = parts.length > 1 ? `${slug(p.title)}-${slug(part.name)}.${format}` : `${slug(p.title)}.${format}`;
        downloadBytes(part.data, name, format === 'stl' ? 'model/stl' : 'model/3mf');
      }
      setNotice({ tone: 'pass', text: t.forge.exported });
    } catch (e) {
      setNotice({ tone: 'fail', text: (e as Error).message });
    } finally {
      setExporting(null);
    }
  }

  async function exportStep() {
    if (!p.forgeId || !values) return;
    setExporting('step');
    setNotice(null);
    try {
      const { job } = await api<{ job: Job }>(`/v1/forges/${p.forgeId}/exports`, { method: 'POST', body: { format: 'step', params: values, ...(p.versionId ? { version_id: p.versionId } : {}) }, idempotent: true });
      const done = await new Promise<Job>((resolve) => {
        const stop = followJob(job.id, (j) => {
          if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
            stop();
            resolve(j);
          }
        });
      });
      if (done.status !== 'SUCCEEDED') throw new Error(done.error?.message ?? t.common.error);
      await downloadFile(p.assetId!, String(done.output!.file_id));
      setNotice({ tone: 'pass', text: t.forge.exported });
      void refresh();
    } catch (e) {
      setNotice({ tone: 'fail', text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setExporting(null);
    }
  }

  async function saveStarter() {
    if (!p.starterKey) return;
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/forge/starter/${p.starterKey}`)}`);
    setSaving(true);
    try {
      const { job } = await api<{ job: Job }>('/v1/forges', { method: 'POST', body: { starter_key: p.starterKey }, idempotent: true });
      router.push(`/forge/new?job=${job.id}`);
    } catch (e) {
      setNotice({ tone: 'fail', text: (e as Error).message });
      setSaving(false);
    }
  }

  function sendToPrint() {
    if (!canPrint || !values) return;
    const q = new URLSearchParams({ ...(p.forgeId ? { forge: p.forgeId } : {}), ...(p.versionId ? { version: p.versionId } : {}), params: JSON.stringify(values), ...(ack ? { ack: '1' } : {}) });
    router.push(`/print?${q}`);
  }

  const dirty = Boolean(values && p.initialParams && JSON.stringify(values) !== JSON.stringify(validateParams(schema ?? {}, p.initialParams).values));
  return (
    <>
    {p.header ? p.header(values, dirty) : null}
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--sw-text)]">{p.title}</h1>
          {p.starterKey ? <Badge tone="accent">{t.forge.starterBadge}</Badge> : null}
          {p.versionNumber ? <Badge>{t.forge.version(p.versionNumber)}</Badge> : null}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCodeOpen(true)}>
              {t.forge.code}
            </Button>
            {p.starterKey ? (
              <Button size="sm" onClick={saveStarter} loading={saving}>
                {t.forge.save}
              </Button>
            ) : null}
          </div>
        </div>
        <ModelViewer
          meshes={meshes}
          busy={busy && meshes !== undefined}
          className="h-[52vh] min-h-[320px]"
          label={`${p.title} preview`}
          selectMode={selectMode}
          onSelect={(h) => setHits(h)}
          highlightFeature={targetFeature}
          marker={shown?.location ?? null}
          overhangDeg={shown?.overhang ? (printer?.overhang_deg ?? 45) : null}
        />
        {runtime.status === 'starting' ? <p className="text-sm text-[var(--sw-text-muted)]">{t.forge.runtimeLoading}</p> : null}
        {runtime.status === 'error' ? <Alert tone="fail" title={t.forge.buildError}>{runtime.error}</Alert> : null}
        {buildError ? <Alert tone="fail" title={t.forge.buildError}>{buildError}</Alert> : null}
        {assumed.length && schema ? (
          <Alert
            tone="warn"
            title={t.forge.assumedTitle}
            action={
              p.forgeId ? (
                <Button size="sm" onClick={confirmSizes} loading={confirming} data-testid="confirm-sizes">
                  {t.forge.confirmSizes}
                </Button>
              ) : null
            }
          >
            <span data-testid="assumed-sizes">{t.forge.assumedLead(assumed.map((k) => `${schema[k]?.label ?? k} (${String(values?.[k])} mm)`).join(', '))}</span>
            {!p.forgeId ? <span> {t.forge.assumedNotOwner}</span> : null}
          </Alert>
        ) : null}
        <section aria-labelledby="exports-h" className="space-y-2">
          <h2 id="exports-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
            {t.forge.exports}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportLocal('stl')} loading={exporting === 'stl'} disabled={!meshes || exporting !== null || assumed.length > 0} data-testid="export-stl">
              {t.forge.exportStl}
            </Button>
            <Button variant="secondary" onClick={() => exportLocal('3mf')} loading={exporting === '3mf'} disabled={!meshes || exporting !== null || assumed.length > 0}>
              {t.forge.export3mf}
            </Button>
            <Button variant="secondary" onClick={exportStep} loading={exporting === 'step'} disabled={!p.forgeId || !meshes || exporting !== null || assumed.length > 0}>
              {t.forge.exportStep}
            </Button>
          </div>
          <p className="text-xs text-[var(--sw-text-muted)]">{p.forgeId ? t.forge.stepNote(p.stepCost ?? 2) : t.forge.stepSignIn}</p>
          {notice ? <Alert tone={notice.tone} title={notice.text} /> : null}
        </section>
      </div>
      <aside className="space-y-6">
        {schema && values ? <ParamPanel schema={schema} values={values} onChange={onParam} clampNotes={clampNotes} dimensions={dims} initial={p.initialParams} /> : <p className="text-sm text-[var(--sw-text-muted)]">{t.common.loading}</p>}
        {p.forgeId && printer ? <PrinterPanel forgeId={p.forgeId} printer={printer} onChange={setPrinter} /> : null}
        {p.forgeId && schema && values ? <PhotoMeasure forgeId={p.forgeId} versionId={p.versionId} schema={schema} dimensions={dims} onSaved={(v) => router.push(`/forge/${p.forgeId}?version=${v}`)} /> : null}
        {p.forgeId ? (
          <CopilotPanel forgeId={p.forgeId} versionId={p.versionId} selectMode={selectMode} onSelectMode={setSelectMode} hits={hits} onTarget={setTargetFeature} />
        ) : null}
        <ChecksPanel checks={checks} busy={busy} shown={shown?.id ?? null} onShow={(c) => setShown(c ? { id: c.id, location: c.location ?? null, overhang: c.id.startsWith('overhang:') } : null)} />
        <EstimatesPanel report={report} meshes={meshes} features={features} />
        <div className="space-y-2">
          {failing.length ? (
            <label className="flex items-start gap-2 text-sm text-[var(--sw-text)]">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--sw-accent)]" data-testid="ack-checks" />
              {t.forge.acknowledge}
            </label>
          ) : null}
          <Button className="w-full" onClick={sendToPrint} disabled={!canPrint} data-testid="send-to-print" aria-describedby={!canPrint && failing.length ? 'print-blocked' : undefined}>
            {t.forge.sendToPrint}
          </Button>
          {!canPrint && failing.length && !ack ? (
            <p id="print-blocked" className="text-xs text-[var(--sw-fail)]">
              {t.forge.printBlocked}
            </p>
          ) : null}
        </div>
      </aside>
      <Dialog open={codeOpen} onClose={() => setCodeOpen(false)} title={t.forge.codeTitle} footer={<Button variant="secondary" onClick={() => setCodeOpen(false)}>{t.common.close}</Button>}>
        <pre className="max-h-[60vh] overflow-auto rounded bg-[var(--sw-surface)] p-3 font-mono text-xs text-[var(--sw-text)]">{p.code}</pre>
      </Dialog>
    </div>
    </>
  );
}
