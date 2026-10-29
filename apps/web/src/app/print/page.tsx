'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { pricingConfig } from '@sw/pricing';
import { formatMoney } from '@sw/shared';
import { Alert, Badge, Button, Card, Spinner } from '@sw/ui';
import { api, type ApiError, followJob, type Job } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false });
const cfg = pricingConfig();

interface Analysis { watertight: boolean; manifold: boolean; flipped_normals: boolean; fits_build_volume: boolean; overhang_area_mm2: number; bbox_mm: number[]; triangles: number; notes: string[] }
interface Part { id: string; title: string; status: string; analysis: Analysis | null; repair: { before: Analysis | null; after: Analysis; actions: string[] } | null; use_repaired: boolean; settings: Record<string, unknown>; checks_failing: boolean; checks_acknowledged: boolean; job_id: string | null }
interface Quote { id: string; is_estimate: boolean; orderable: boolean; total_minor: number; subtotal_minor: number; shipping_minor: number; tax_note: string; lead_time_days: number; expires_at: string; lines: { unit_price_minor: number; setup_fee_minor: number; quantity: number; material: string; filament_g: number; print_time_h: number }[] }

const DEFAULTS = { material: 'PLA', color: 'black', layer_height_um: 200, infill_pct: 20, supports: 'auto', orientation: 'as-uploaded', scale_pct: 100, quantity: 1, shipping: 'standard' };

function Report({ a }: { a: Analysis }) {
  const row = (ok: boolean, text: string) => (
    <li className="flex gap-2 text-sm"><span aria-hidden="true" className={ok ? 'text-[var(--sw-pass)]' : 'text-[var(--sw-fail)]'}>{ok ? '✓' : '✕'}</span><span className="text-[var(--sw-text)]">{text}</span></li>
  );
  return (
    <ul className="space-y-1" data-testid="validation-report">
      {row(a.watertight && a.manifold, a.watertight && a.manifold ? t.print.watertight : t.print.notWatertight)}
      {a.flipped_normals ? row(false, t.print.flipped) : null}
      {row(a.fits_build_volume, a.fits_build_volume ? t.print.fits : t.print.tooBig)}
      {a.overhang_area_mm2 > 1 ? <li className="text-sm text-[var(--sw-warn)]">! {t.print.overhangs(a.overhang_area_mm2)}</li> : null}
      <li className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">{a.bbox_mm.map((n) => n.toFixed(1)).join(' × ')} mm · {a.triangles} triangles</li>
      {a.notes.map((n) => <li key={n} className="text-xs text-[var(--sw-text-muted)]">{n}</li>)}
    </ul>
  );
}

function PrintFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useSession();
  const [part, setPart] = useState<Part | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>(DEFAULTS);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meshUrl, setMeshUrl] = useState<{ url: string; format: 'stl' } | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [added, setAdded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);

  const loadPart = useCallback(async (id: string) => {
    const { part: p } = await api<{ part: Part }>(`/v1/print/parts/${id}`);
    setPart(p);
    setSettings({ ...DEFAULTS, ...p.settings });
    return p;
  }, []);

  // Start from ?part=, or from a forge (?forge=…&params=…), or wait for an upload.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const partId = params.get('part');
    const forge = params.get('forge');
    if (partId) void loadPart(partId).catch(() => setError(t.errors.notFound));
    else if (forge) {
      setPhase(t.print.fromForge);
      api<{ part: Part }>('/v1/print/parts', { method: 'POST', idempotent: true, body: { forge_id: forge, ...(params.get('version') ? { version_id: params.get('version') } : {}), params: JSON.parse(params.get('params') ?? '{}'), acknowledge_checks: params.get('ack') === '1' } })
        .then(({ part: p }) => {
          router.replace(`/print?part=${p.id}`);
          const stop = followJob(p.job_id!, async (j) => {
            if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
              stop();
              setPhase(null);
              await loadPart(p.id);
            }
          });
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [params, router, loadPart]);

  async function onFile(file: File) {
    setError(null);
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    const type = ext === '3mf' ? 'model/3mf' : ext === 'obj' ? 'model/obj' : 'model/stl';
    try {
      setPhase(t.print.uploading);
      const c = await api<{ upload: { id: string }; put: { url: string; headers: Record<string, string> } }>('/v1/uploads', { method: 'POST', body: { filename: file.name, content_type: type, bytes: file.size, purpose: 'print' } });
      const put = await fetch(c.put.url, { method: 'PUT', headers: c.put.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setPhase(t.print.checking);
      await api(`/v1/uploads/${c.upload.id}/complete`, { method: 'POST' });
      const { part: p } = await api<{ part: Part }>('/v1/print/parts', { method: 'POST', idempotent: true, body: { upload_id: c.upload.id } });
      setPart(p);
      router.replace(`/print?part=${p.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  }

  // Viewer mesh: the repaired one when chosen.
  useEffect(() => {
    if (!part || !['READY', 'NEEDS_REPAIR'].includes(part.status)) return;
    const which = part.use_repaired && part.repair && !showBefore ? 'repaired' : 'source';
    api<{ url: string; format: string }>(`/v1/print/parts/${part.id}/mesh?which=${which}`).then((r) => setMeshUrl({ url: r.url, format: 'stl' })).catch(() => setMeshUrl(null));
  }, [part, showBefore]);

  // Requote 300 ms after the last change.
  const ready = part && ['READY', 'NEEDS_REPAIR'].includes(part.status);
  useEffect(() => {
    if (!part || !ready) return;
    const h = setTimeout(async () => {
      try {
        const r = await api<{ part: Part; quote: Quote | null }>(`/v1/print/parts/${part.id}`, { method: 'PATCH', body: { settings } });
        setQuote(r.quote);
        setQuoteError(null);
      } catch (e) {
        const err = e as ApiError;
        setQuote(null);
        setQuoteError(err.code === 'PART_TOO_LARGE' ? `${err.message}. Try ${String(err.details.suggested_scale_pct)}% scale.` : err.message);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [settings, part, ready]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);

  async function repair() {
    if (!part) return;
    setPhase(t.print.repairing);
    const { job } = await api<{ job: Job }>(`/v1/print/parts/${part.id}/repair`, { method: 'POST', idempotent: true });
    const stop = followJob(job.id, async (j) => {
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
        stop();
        setPhase(null);
        await loadPart(part.id);
      }
    });
  }

  async function toggleRepaired(v: boolean) {
    if (!part) return;
    const r = await api<{ part: Part; quote: Quote | null }>(`/v1/print/parts/${part.id}`, { method: 'PATCH', body: { use_repaired: v, settings } });
    setPart(r.part);
    setQuote(r.quote);
  }

  async function acknowledge(v: boolean) {
    if (!part) return;
    const r = await api<{ part: Part; quote: Quote | null }>(`/v1/print/parts/${part.id}`, { method: 'PATCH', body: { acknowledge_checks: v, settings } });
    setPart(r.part);
    setQuote(r.quote);
  }

  async function addToCart() {
    if (!quote) return;
    if (!me) return router.push(`/sign-in?next=${encodeURIComponent(`/print?part=${part!.id}`)}`);
    try {
      await api(`/v1/print/quotes/${quote.id}/claim`, { method: 'POST' }).catch(() => undefined);
      await api('/v1/cart/items', { method: 'POST', body: { quote_id: quote.id } });
      setAdded(true);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'QUOTE_CHANGED') setQuote(err.details.quote as Quote);
      setError(err.message);
    }
  }

  const set = (k: string, v: unknown) => {
    setAdded(false);
    setSettings((s) => ({ ...s, [k]: v }));
  };
  const field = 'block space-y-1 text-sm';
  const sel = 'h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-[var(--sw-text)]';
  const analysis = part?.use_repaired && part.repair && !showBefore ? part.repair.after : part?.analysis;
  const material = String(settings.material);
  const minutesLeft = quote ? Math.max(0, Math.round((new Date(quote.expires_at).getTime() - now) / 60_000)) : 0;

  if (!part) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.print.title}</h1>
        <p className="text-sm text-[var(--sw-text-muted)]">{t.print.lead}</p>
        {phase ? <p className="flex items-center gap-2 text-[var(--sw-text)]" role="status"><Spinner /> {phase}</p> : (
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[var(--sw-border)] p-10 text-center text-[var(--sw-text)]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void onFile(f);
            }}
          >
            <span>{t.print.drop}</span>
            <span className="rounded bg-[var(--sw-accent)] px-3 py-1.5 text-sm text-[var(--sw-accent-contrast)]">{t.print.choose}</span>
            <input type="file" accept=".stl,.obj,.3mf" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="print-file" />
          </label>
        )}
        {error ? <Alert tone="fail" title={error} /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-[var(--sw-text)]">{part.title}</h1>
        {meshUrl ? <ModelViewer key={meshUrl.url.split('?')[0]} url={meshUrl.url} format="stl" overhangDeg={45} className="h-[48vh] min-h-[300px]" label={`${part.title} print preview`} /> : <div className="flex h-[48vh] items-center justify-center rounded-lg bg-[var(--sw-viewer-bg)]">{phase ? <Spinner /> : null}</div>}
        {phase ? <p className="flex items-center gap-2 text-sm text-[var(--sw-text)]" role="status"><Spinner small /> {phase}</p> : null}
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--sw-text)]">{t.print.report}</h2>
            {part.repair ? (
              <div className="flex gap-1" role="group" aria-label="Compare">
                <Button size="sm" variant={showBefore ? 'secondary' : 'ghost'} aria-pressed={showBefore} onClick={() => setShowBefore(true)}>{t.print.before}</Button>
                <Button size="sm" variant={!showBefore ? 'secondary' : 'ghost'} aria-pressed={!showBefore} onClick={() => setShowBefore(false)}>{t.print.after}</Button>
              </div>
            ) : null}
          </div>
          {analysis ? <Report a={analysis} /> : <p className="text-sm text-[var(--sw-text-muted)]">{t.print.checking}</p>}
          {part.repair?.actions.map((a) => <p key={a} className="text-xs text-[var(--sw-text-muted)]">✓ {a}</p>)}
          {part.status === 'NEEDS_REPAIR' && !part.repair ? <Button size="sm" onClick={repair} disabled={phase !== null} data-testid="repair-part">{t.print.repair}</Button> : null}
          {part.repair ? (
            <label className="flex items-center gap-2 text-sm text-[var(--sw-text)]">
              <input type="checkbox" checked={part.use_repaired} onChange={(e) => toggleRepaired(e.target.checked)} className="accent-[var(--sw-accent)]" /> {t.print.useRepaired}
            </label>
          ) : null}
        </Card>
      </div>
      <aside className="space-y-4">
        <section className="space-y-3" aria-labelledby="cfg-h">
          <h2 id="cfg-h" className="text-sm font-semibold uppercase text-[var(--sw-text-muted)]">{t.print.configure}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className={field}><span>{t.print.material}</span>
              <select className={sel} value={material} onChange={(e) => { set('material', e.target.value); set('color', cfg.colors[e.target.value]?.[0]); }} data-testid="material">
                {Object.keys(cfg.materials).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={field}><span>{t.print.color}</span>
              <select className={sel} value={String(settings.color)} onChange={(e) => set('color', e.target.value)}>
                {(cfg.colors[material] ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={field}><span>{t.print.layer}</span>
              <select className={sel} value={Number(settings.layer_height_um)} onChange={(e) => set('layer_height_um', Number(e.target.value))}>
                {cfg.layer_heights_um.map((l) => <option key={l} value={l}>{(l / 1000).toFixed(2)} mm</option>)}
              </select>
            </label>
            <label className={field}><span>{t.print.infill} <span className="font-mono tabular-nums">{String(settings.infill_pct)}%</span></span>
              <input type="range" min={cfg.infill_pct.min} max={cfg.infill_pct.max} step={5} value={Number(settings.infill_pct)} onChange={(e) => set('infill_pct', Number(e.target.value))} className="w-full accent-[var(--sw-accent)]" />
            </label>
            <label className={field}><span>{t.print.supports}</span>
              <select className={sel} value={String(settings.supports)} onChange={(e) => set('supports', e.target.value)}>
                {Object.entries(t.print.supportOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className={field}><span>{t.print.orientation}</span>
              <select className={sel} value={String(settings.orientation)} onChange={(e) => set('orientation', e.target.value)}>
                {Object.entries(t.print.orientationOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className={field}><span>{t.print.scale} <span className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">{analysis ? analysis.bbox_mm.map((n) => ((n * Number(settings.scale_pct)) / 100).toFixed(1)).join('×') : ''} mm</span></span>
              <input type="number" min={1} max={1000} value={Number(settings.scale_pct)} onChange={(e) => set('scale_pct', Number(e.target.value))} className={`${sel} font-mono tabular-nums`} />
            </label>
            <label className={field}><span>{t.print.quantity}</span>
              <input type="number" min={1} max={500} value={Number(settings.quantity)} onChange={(e) => set('quantity', Number(e.target.value))} className={`${sel} font-mono tabular-nums`} data-testid="quantity" />
            </label>
            <label className={`${field} col-span-2`}><span>{t.print.shipping}</span>
              <select className={sel} value={String(settings.shipping)} onChange={(e) => set('shipping', e.target.value)}>
                {Object.entries(t.print.shippingOptions).map(([k, v]) => <option key={k} value={k}>{v} · {formatMoney(cfg.shipping_minor[k] ?? 0)}</option>)}
              </select>
            </label>
          </div>
        </section>
        <Card className="space-y-2 p-3" aria-live="polite" data-testid="quote">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--sw-text)]">{t.print.quote}</h2>
            {quote?.is_estimate ? <Badge tone="warn">{t.print.estimate}</Badge> : null}
          </div>
          {quoteError ? <Alert tone="fail" title={quoteError} /> : null}
          {quote ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--sw-text-muted)]">{t.print.unit} × {quote.lines[0]!.quantity}</dt><dd className="font-mono tabular-nums">{formatMoney(quote.lines[0]!.unit_price_minor)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--sw-text-muted)]">{t.print.setup}</dt><dd className="font-mono tabular-nums">{formatMoney(quote.lines[0]!.setup_fee_minor)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--sw-text-muted)]">{t.print.shipping}</dt><dd className="font-mono tabular-nums">{formatMoney(quote.shipping_minor)}</dd></div>
              <div className="flex justify-between border-t border-[var(--sw-border)] pt-1 font-semibold"><dt>{t.print.total}</dt><dd className="font-mono tabular-nums" data-testid="quote-total">{formatMoney(quote.total_minor)}</dd></div>
              <p className="text-xs text-[var(--sw-text-muted)]">{quote.tax_note} {t.print.leadTime(quote.lead_time_days)}. {t.print.expires(minutesLeft)}.</p>
              <p className="text-xs text-[var(--sw-text-muted)]">{quote.lines[0]!.filament_g} g · {quote.lines[0]!.print_time_h} h</p>
              {quote.is_estimate ? <p className="text-xs text-[var(--sw-warn)]">{t.print.estimateNote} {quote.orderable ? '' : t.print.notOrderable}</p> : null}
            </dl>
          ) : !quoteError ? <p className="text-sm text-[var(--sw-text-muted)]">{t.common.loading}</p> : null}
        </Card>
        {part.checks_failing ? (
          <Alert tone="warn" title={t.print.checksBlocked}>
            <label className="mt-1 flex items-center gap-2 text-sm text-[var(--sw-text)]">
              <input type="checkbox" checked={part.checks_acknowledged} onChange={(e) => acknowledge(e.target.checked)} className="accent-[var(--sw-accent)]" /> {t.print.acknowledge}
            </label>
          </Alert>
        ) : null}
        <Button className="w-full" onClick={addToCart} disabled={!quote || !quote.orderable || part.status !== 'READY' || (part.checks_failing && !part.checks_acknowledged)} data-testid="add-to-cart">
          {me ? t.print.addToCart : t.print.signInToBuy}
        </Button>
        {added ? <Alert tone="pass" title={t.print.added}><Link href="/cart" className="underline">{t.print.viewCart}</Link></Alert> : null}
        {error ? <Alert tone="fail" title={error} /> : null}
      </aside>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense>
      <PrintFlow />
    </Suspense>
  );
}
