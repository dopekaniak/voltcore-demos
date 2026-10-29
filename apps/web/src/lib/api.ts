'use client';
/** Browser API client: same-origin /api, typed errors, idempotency keys on creating POSTs. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotent?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.idempotent) headers['idempotency-key'] = crypto.randomUUID();
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Request failed (${res.status})`, e.details ?? {});
  }
  return json as T;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN' | 'OPS';
  plan: string;
  totp_enabled: boolean;
}
export interface Wallet {
  balance: number;
  reserved: number;
  available: number;
  expiring: { amount: number; expires_at: string }[];
  plan: string;
}
export interface Job {
  id: string;
  kind: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'RETRYING' | 'FAILED' | 'CANCELED';
  progress: number;
  forge_state: string | null;
  error: { code: string; message: string } | null;
  output: Record<string, unknown> | null;
  reserved_credits: number;
  committed_credits: number;
}

/**
 * Follow a job with SSE until it ends. Progress comes from the event payloads, so a job
 * costs one GET at the start and the final state arrives with the `end` event (the API
 * rate-limits signed-in users to 60 requests a minute). Falls back to slow polling.
 */
export function followJob(jobId: string, onUpdate: (job: Job) => void): () => void {
  let stopped = false;
  let es: EventSource | null = null;
  let current: Job | null = null;
  const final = (j: Job) => ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status);
  const emit = (patch: Partial<Job>) => {
    if (!current || stopped) return;
    current = { ...current, ...patch };
    onUpdate(current);
  };
  const poll = async () => {
    while (!stopped) {
      try {
        const j = await api<Job>(`/v1/jobs/${jobId}`);
        current = j;
        onUpdate(j);
        if (final(j)) return;
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  void api<Job>(`/v1/jobs/${jobId}`)
    .then((j) => {
      if (stopped) return;
      current = j;
      onUpdate(j);
      if (final(j)) return;
      es = new EventSource(`/api/v1/jobs/${jobId}/events`);
      const read = (e: Event) => JSON.parse((e as MessageEvent).data) as { to?: Job['status'] | null; progress?: number | null; data?: { to?: string } | null };
      es.addEventListener('status', (e) => {
        const d = read(e);
        // Final states arrive with the full job (and its output) in the `end` event.
        if (d.to && ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(d.to)) return;
        emit({ ...(d.to ? { status: d.to } : {}), ...(typeof d.progress === 'number' ? { progress: d.progress } : {}) });
      });
      es.addEventListener('progress', (e) => {
        const d = read(e);
        if (typeof d.progress === 'number') emit({ progress: d.progress });
      });
      es.addEventListener('forge_state', (e) => {
        const d = read(e);
        if (d.data?.to) emit({ forge_state: d.data.to });
      });
      es.addEventListener('end', (e) => {
        es?.close();
        const j2 = JSON.parse((e as MessageEvent).data) as Job | null;
        if (j2 && !stopped) {
          current = j2;
          onUpdate(j2);
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped && current && !final(current)) void poll();
      };
    })
    .catch(() => void poll());
  return () => {
    stopped = true;
    es?.close();
  };
}

/** Save bytes as a download. */
export function downloadBytes(data: Uint8Array | ArrayBuffer, filename: string, mime: string) {
  const blob = new Blob([data instanceof Uint8Array ? (data as BlobPart) : new Uint8Array(data)], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
