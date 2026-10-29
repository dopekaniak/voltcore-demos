'use client';
import { useEffect, useRef, useState } from 'react';
import type { ViewerMesh } from '@sw/ui';
import type { ForgeReport } from '@sw/forge-kit/browser';

const RUNTIME_ORIGIN = process.env.NEXT_PUBLIC_FORGE_RUNTIME_ORIGIN ?? 'http://localhost:3002';

export interface LoadedPart {
  meta: { title?: string } | null;
  parameters: unknown;
  defaults: Record<string, unknown>;
  view: string;
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error & { code?: string | undefined }) => void };

/**
 * The forge sandbox (ADR-008): a hidden iframe on the runtime origin with
 * sandbox="allow-scripts allow-same-origin" (a different origin, so it cannot reach this
 * page). Model code is sent by postMessage and runs only in the iframe's Web Worker.
 */
export function useForgeRuntime(code: string | null) {
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const ready = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [loaded, setLoaded] = useState<LoadedPart | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumps every time a model finishes loading, so callers rebuild after a runtime restart.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!code) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('title', 'Forge geometry sandbox');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    frame.src = `${RUNTIME_ORIGIN}/`;
    iframe.current = frame;
    let readyResolve!: () => void;
    let readyCount = 0;
    ready.current = new Promise((r) => (readyResolve = r));
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== RUNTIME_ORIGIN || e.source !== frame.contentWindow) return;
      const m = e.data as { type: string; reqId?: number; code?: string; message?: string };
      if (m.type === 'runtime-ready') {
        readyCount++;
        if (readyCount === 1) return readyResolve();
        // The runtime page reloaded: requests in flight are lost; load the model again.
        for (const p of pending.current.values()) p.reject(Object.assign(new Error('The geometry engine restarted; try again.'), { code: 'RUNTIME_RESTARTED' }));
        pending.current.clear();
        void load();
        return;
      }
      const p = m.reqId !== undefined ? pending.current.get(m.reqId) : undefined;
      if (!p) return;
      pending.current.delete(m.reqId!);
      if (m.type === 'error') p.reject(Object.assign(new Error(m.message ?? 'build failed'), { code: m.code }));
      else p.resolve(m as Record<string, unknown>);
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(frame);
    setStatus('starting');
    const load = () =>
      send({ type: 'load', code })
        .then((m) => {
          setLoaded({ meta: m.meta as LoadedPart['meta'], parameters: m.parameters, defaults: (m.defaults ?? {}) as Record<string, unknown>, view: String(m.view) });
          setStatus('ready');
          setGeneration((g) => g + 1);
        })
        .catch((e: Error & { code?: string }) => {
          if (e.code === 'RUNTIME_RESTARTED' || e.code === 'CLOSED') return;
          setError(e.message);
          setStatus('error');
        });
    void load();
    const waiting = pending.current;
    return () => {
      window.removeEventListener('message', onMsg);
      for (const p of waiting.values()) p.reject(Object.assign(new Error('closed'), { code: 'CLOSED' }));
      waiting.clear();
      frame.remove();
      iframe.current = null;
    };
  }, [code]);

  async function send(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    await ready.current;
    const reqId = nextId.current++;
    return new Promise((resolve, reject) => {
      pending.current.set(reqId, { resolve, reject });
      iframe.current?.contentWindow?.postMessage({ ...msg, reqId }, RUNTIME_ORIGIN);
    });
  }

  return {
    status,
    loaded,
    error,
    generation,
    async build(params: Record<string, unknown>): Promise<{ meshes: ViewerMesh[]; superseded: boolean; ms: number }> {
      const m = await send({ type: 'build', params });
      return { meshes: (m.meshes as ViewerMesh[]) ?? [], superseded: Boolean(m.superseded), ms: Number(m.ms ?? 0) };
    },
    async inspect(params: Record<string, unknown>): Promise<ForgeReport> {
      return (await send({ type: 'inspect', params })).report as ForgeReport;
    },
    async exportFile(format: 'stl' | '3mf', params: Record<string, unknown>): Promise<{ name: string; data: Uint8Array }[]> {
      return (await send({ type: 'export', format, params })).parts as { name: string; data: Uint8Array }[];
    },
  };
}
