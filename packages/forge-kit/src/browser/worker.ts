/// <reference lib="webworker" />
/**
 * Browser forge worker (ADR-008). Runs inside the forge-runtime origin, which serves it
 * with a strict CSP. AI-written model code is evaluated here and nowhere else in the
 * browser: the static check runs first, then the code is imported from a blob: URL.
 */
import { runWorker } from 'partforge/worker';
import * as geometry from 'partforge/geometry';
import * as derive from 'partforge/derive';
import { rewriteImports, staticCheck } from '../static-check';
import { defaultView, inspectPart, subpartsFor } from '../runtime/inspect.js';

type Part = Parameters<typeof runWorker>[0];
let handle: ReturnType<typeof runWorker> | null = null;
const g = globalThis as unknown as { __swModules?: unknown };
g.__swModules = Object.freeze({ 'partforge/geometry': geometry, 'partforge/derive': derive });

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data as { type?: string; code?: string; loadId?: number };
  if (msg?.type !== 'sw-load' || typeof msg.code !== 'string') return;
  const check = staticCheck(msg.code);
  if (!check.ok) {
    self.postMessage({ type: 'sw-load-error', loadId: msg.loadId, code: 'FORGE_STATIC_CHECK_FAILED', issues: check.issues });
    return;
  }
  let part: Part;
  const url = URL.createObjectURL(new Blob([rewriteImports(msg.code)], { type: 'text/javascript' }));
  try {
    part = (await import(/* @vite-ignore */ url)).default as Part;
    if (!part || typeof part !== 'object' || !(part as { parts?: unknown }).parts) throw new Error('the model does not export a part definition');
  } catch (err) {
    self.postMessage({ type: 'sw-load-error', loadId: msg.loadId, code: 'FORGE_BUILD_FAILED', message: String((err as Error)?.message ?? err) });
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!handle) {
    handle = runWorker(part, {
      jobs: {
        'sw-inspect': (kernel, p, m, post) => {
          const params = (m.params ?? {}) as Record<string, unknown>;
          post({ type: 'sw-report', jobId: m.jobId, report: inspectPart(kernel, p, params, m.profile as string | undefined) });
        },
        'sw-subparts': (_kernel, p, m, post) => {
          const params = (m.params ?? {}) as Record<string, unknown>;
          post({ type: 'sw-subparts', jobId: m.jobId, subparts: subpartsFor(p, defaultView(p), params) });
        },
      },
    });
  } else {
    handle.setPart(part);
  }
  const p = part as unknown as { meta?: unknown; parameters?: unknown; defaults?: Record<string, unknown>; views?: Record<string, unknown> };
  self.postMessage({
    type: 'sw-loaded',
    loadId: msg.loadId,
    meta: jsonSafe(p.meta),
    parameters: jsonSafe(p.parameters),
    defaults: jsonSafe(p.defaults),
    view: defaultView(part),
    views: Object.keys(p.views ?? {}),
  });
});
