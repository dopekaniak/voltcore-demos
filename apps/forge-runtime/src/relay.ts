/**
 * Forge sandbox relay (ADR-008). This page runs in a sandboxed iframe on its own origin.
 * It never evaluates model code: it starts the Web Worker, forwards requests from the
 * web app (checked by origin), serializes them, and enforces the 20 s build timeout by
 * terminating and restarting the worker.
 */
const WEB_ORIGIN: string = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:3000';
const TIMEOUT_MS = Number(import.meta.env.VITE_FORGE_TIMEOUT_MS ?? 20000);

type Req =
  | { type: 'load'; reqId: number; code: string; profile?: string }
  | { type: 'build'; reqId: number; params: Record<string, unknown> }
  | { type: 'inspect'; reqId: number; params: Record<string, unknown>; profile?: string }
  | { type: 'export'; reqId: number; params: Record<string, unknown>; format: 'stl' | '3mf' };

type WorkerMsg = { type: string; jobId?: number; loadId?: number; [k: string]: unknown };

let worker: Worker | null = null;
let current: { code: string; profile?: string } | null = null;
let view = '';
let nextJob = 1;
const queue: Req[] = [];
let busy = false;

function toBytes(d: ArrayBuffer | Uint8Array): Uint8Array {
  return d instanceof Uint8Array ? d : new Uint8Array(d);
}

function reply(msg: Record<string, unknown>, transfer: Transferable[] = []) {
  window.parent.postMessage(msg, WEB_ORIGIN, transfer);
}

const failWaiters = new Set<(e: Error & { code?: string }) => void>();

function spawn(): Worker {
  worker?.terminate();
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'manifold' });
  // A worker that cannot start (bad module, blocked WASM) fails every waiting request.
  w.addEventListener('error', (e) => {
    const err = Object.assign(new Error(`The geometry engine could not start: ${e.message || 'worker error'}`), { code: 'RUNTIME_FAILED' });
    for (const f of failWaiters) f(err);
  });
  worker = w;
  return w;
}

/** Send to the worker and resolve with the first message `accept` recognises. */
function ask(msg: Record<string, unknown>, accept: (m: WorkerMsg) => boolean | 'reject'): Promise<WorkerMsg> {
  const w = worker!;
  return new Promise((resolve, reject) => {
    const onFail = (err: Error) => {
      clearTimeout(timer);
      w.removeEventListener('message', onMsg);
      failWaiters.delete(onFail);
      reject(err);
    };
    failWaiters.add(onFail);
    const timer = setTimeout(() => {
      failWaiters.delete(onFail);
      w.removeEventListener('message', onMsg);
      spawn();
      reject(Object.assign(new Error(`The build did not finish within ${Math.round(TIMEOUT_MS / 1000)} s.`), { code: 'FORGE_BUILD_TIMEOUT', restart: true }));
    }, TIMEOUT_MS);
    const onMsg = (e: MessageEvent) => {
      const m = e.data as WorkerMsg;
      const verdict = accept(m);
      if (!verdict) return;
      clearTimeout(timer);
      failWaiters.delete(onFail);
      w.removeEventListener('message', onMsg);
      if (verdict === 'reject') {
        const issues = m.issues as { line: number; message: string }[] | undefined;
        const text = m.message ?? issues?.map((i) => `line ${i.line}: ${i.message}`).join('; ') ?? 'build failed';
        reject(Object.assign(new Error(String(text)), { code: String(m.code ?? 'FORGE_BUILD_FAILED'), issues }));
      }
      else resolve(m);
    };
    w.addEventListener('message', onMsg);
    w.postMessage(msg);
  });
}

async function load(code: string, profile?: string) {
  if (!worker) spawn();
  const loadId = nextJob++;
  const m = await ask({ type: 'sw-load', code, loadId }, (x) => (x.loadId === loadId ? (x.type === 'sw-loaded' ? true : x.type === 'sw-load-error' ? 'reject' : false) : false));
  current = { code, ...(profile ? { profile } : {}) };
  view = String(m.view);
  return m;
}

async function ensureLoaded() {
  if (!worker && current) await load(current.code, current.profile);
}

async function handle(req: Req) {
  try {
    if (req.type === 'load') {
      const m = await load(req.code, req.profile);
      reply({ type: 'loaded', reqId: req.reqId, meta: m.meta, parameters: m.parameters, defaults: m.defaults, view: m.view, views: m.views });
      return;
    }
    await ensureLoaded();
    if (!current) throw Object.assign(new Error('no model loaded'), { code: 'NOT_LOADED' });
    if (req.type === 'build') {
      const t0 = performance.now();
      const sj = nextJob++;
      const sub = await ask({ type: 'sw-subparts', params: req.params, jobId: sj }, (m) => (m.jobId === sj ? (m.type === 'sw-subparts' ? true : m.type === 'error' ? 'reject' : false) : false));
      const gj = nextJob++;
      const res = await ask(
        { type: 'generate', view, params: req.params, subparts: sub.subparts, jobId: gj, cache: true },
        (m) => (m.type === 'meshes' || m.type === 'superseded' ? true : m.type === 'error' && m.jobId === gj ? 'reject' : false),
      );
      const meshes = (res.meshes as { name: string; positions: Float32Array; normals: Float32Array; indices?: Uint32Array; triangles: number }[] | undefined) ?? [];
      const out = meshes.map((x) => ({ name: x.name, positions: x.positions, normals: x.normals, indices: x.indices, triangles: x.triangles }));
      const transfer = out.flatMap((x) => [x.positions.buffer, x.normals.buffer, ...(x.indices ? [x.indices.buffer] : [])]);
      reply({ type: 'meshes', reqId: req.reqId, meshes: out, ms: Math.round(performance.now() - t0), superseded: res.type === 'superseded', warnings: res.warnings ?? [] }, transfer as Transferable[]);
    } else if (req.type === 'inspect') {
      const j = nextJob++;
      const r = await ask({ type: 'sw-inspect', params: req.params, profile: req.profile ?? current.profile, jobId: j }, (m) => (m.jobId === j ? (m.type === 'sw-report' ? true : m.type === 'error' ? 'reject' : false) : false));
      reply({ type: 'report', reqId: req.reqId, report: r.report });
    } else if (req.type === 'export') {
      const j = nextJob++;
      const type = req.format === 'stl' ? 'export-stl' : 'export-3mf';
      const r = await ask({ type, view, params: req.params, jobId: j, name: 'forge', quality: 'print' }, (m) =>
        m.jobId === j ? (m.type === 'download' || m.type === 'download-parts' ? true : m.type === 'error' ? 'reject' : false) : false,
      );
      if (r.type === 'download-parts') {
        const parts = (r.parts as { name: string; data: ArrayBuffer | Uint8Array }[]).map((p) => ({ name: p.name, data: toBytes(p.data) }));
        reply({ type: 'files', reqId: req.reqId, format: 'stl', parts }, parts.map((p) => p.data.buffer as ArrayBuffer));
      } else {
        const data = toBytes(r.data as ArrayBuffer | Uint8Array);
        reply({ type: 'files', reqId: req.reqId, format: '3mf', parts: [{ name: String(r.filename ?? 'forge.3mf'), data }] }, [data.buffer as ArrayBuffer]);
      }
    }
  } catch (e) {
    const err = e as Error & { code?: string; issues?: unknown; restart?: boolean };
    reply({ type: 'error', reqId: req.reqId, code: err.code ?? 'FORGE_BUILD_FAILED', message: err.message, issues: err.issues ?? null });
    if (err.restart && current) {
      worker = null; // reloaded lazily on the next request
    }
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await handle(queue.shift()!);
  busy = false;
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== WEB_ORIGIN || e.source !== window.parent) return;
  const req = e.data as Req;
  if (!req || typeof req.type !== 'string' || typeof req.reqId !== 'number') return;
  // Coalesce: a newer build replaces a queued one that has not started.
  if (req.type === 'build') {
    const i = queue.findIndex((q) => q.type === 'build');
    if (i >= 0) {
      reply({ type: 'meshes', reqId: queue[i]!.reqId, meshes: [], superseded: true });
      queue.splice(i, 1);
    }
  }
  queue.push(req);
  void pump();
});

reply({ type: 'runtime-ready' });
