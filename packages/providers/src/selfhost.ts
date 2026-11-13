/**
 * Self-hosted generation adapter: our own gen-server (apps/gen-server) on a GPU we rent.
 *
 * - POST {base}/v1/tasks { kind: text | image | refine, ..., idempotency_key } → task.
 *   The server dedupes on idempotency_key, so a create that timed out is safe to resend.
 * - GET {base}/v1/tasks/:id → { status QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELED, progress,
 *   error, outputs: { glb, stl, obj } as server-relative paths }.
 * - Files need the same bearer token; downloads only go to the configured server.
 * - No webhooks: the worker polls. Refine re-runs the preview's input and seed at high
 *   quality. Output is shape only (no textures), which is what printing needs (ADR-044).
 */
import { ProviderError, type Capabilities, type ModelProvider, type NormalizedTask, type OutputFormat, type ProviderInput, type TaskStatus } from './types';

const STATUSES: readonly TaskStatus[] = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'];

interface ServerTask {
  id: string;
  status: string;
  progress?: number;
  error?: { code?: string; message?: string } | null;
  outputs?: Partial<Record<'glb' | 'stl' | 'obj', string>>;
}

export class SelfHostProvider implements ModelProvider {
  readonly key = 'selfhost';
  private readonly base: string;
  constructor(private readonly o: { baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number; sizeMm?: number }) {
    this.base = o.baseUrl.replace(/\/+$/, '');
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await (this.o.fetchImpl ?? fetch)(`${this.base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.o.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new ProviderError('PROVIDER_ERROR', `generation server unreachable: ${(e as Error).message}`, true);
    }
  }

  private async fail(res: Response, what: string): Promise<never> {
    let msg = `${what} failed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: { message?: string }; detail?: unknown };
      const m = b.error?.message ?? (typeof b.detail === 'string' ? b.detail : undefined);
      if (m) msg = `${what} failed: ${m}`;
    } catch {
      /* keep the status-only message */
    }
    const retryable = res.status >= 500 || res.status === 429;
    throw new ProviderError(retryable ? 'PROVIDER_ERROR' : 'PROVIDER_REJECTED', msg, retryable, res.status);
  }

  capabilities(): Capabilities {
    return { textTo3D: true, imageTo3D: true, refine: true, retexture: false, remesh: false, webhooks: false, outputs: ['glb', 'stl', 'obj'] };
  }

  async createTask(input: ProviderInput, ctx: { idempotencyKey: string }): Promise<{ providerTaskId: string }> {
    const common = { idempotency_key: `${this.key}:${ctx.idempotencyKey}`, ...(this.o.sizeMm ? { size_mm: this.o.sizeMm } : {}) };
    let body: Record<string, unknown>;
    if (input.kind === 'preview') body = { kind: 'text', prompt: input.prompt, quality: 'draft', ...common };
    else if (input.kind === 'refine') body = { kind: 'refine', parent_id: input.previewTaskId, ...common };
    else if (input.kind === 'image') {
      if (input.imageUrls.length === 0) throw new ProviderError('PROVIDER_REJECTED', 'an image is required', false);
      body = { kind: 'image', image_url: input.imageUrls[0], remove_background: input.removeBackground ?? true, quality: 'draft', ...common };
    } else throw new ProviderError('NOT_IMPLEMENTED', 'the self-hosted engine makes shapes only; retexture is not available', false);

    // The server dedupes on idempotency_key, so one resend after a network error or 5xx is safe.
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.call('/v1/tasks', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) await this.fail(res, 'create');
        const t = (await res.json()) as ServerTask;
        if (!t.id) throw new ProviderError('PROVIDER_ERROR', 'create returned no task id', false);
        return { providerTaskId: t.id };
      } catch (e) {
        if (attempt === 0 && e instanceof ProviderError && e.retryable) continue;
        throw e;
      }
    }
  }

  async getTask(id: string): Promise<NormalizedTask> {
    const res = await this.call(`/v1/tasks/${encodeURIComponent(id)}`);
    if (!res.ok) await this.fail(res, 'status');
    const t = (await res.json()) as ServerTask;
    const status = (STATUSES as readonly string[]).includes(t.status) ? (t.status as TaskStatus) : 'RUNNING';
    const outputs: NormalizedTask['outputs'] = {};
    for (const [fmt, path] of Object.entries(t.outputs ?? {})) if (path) outputs[fmt as OutputFormat] = `${this.base}${path}`;
    return {
      id: t.id,
      status,
      progress: Math.max(0, Math.min(100, Math.round(t.progress ?? 0))),
      outputs,
      error: status === 'FAILED' ? { code: t.error?.code ?? 'GENERATION_FAILED', message: t.error?.message ?? 'Generation failed' } : null,
    };
  }

  async cancelTask(id: string): Promise<void> {
    const res = await this.call(`/v1/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    if (!res.ok && res.status !== 404) await this.fail(res, 'cancel');
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): null {
    return null;
  }

  async download(url: string): Promise<Buffer> {
    if (!url.startsWith(`${this.base}/v1/tasks/`)) throw new ProviderError('PROVIDER_ERROR', 'outputs come only from the generation server', false);
    const res = await this.call(url.slice(this.base.length), { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) await this.fail(res, 'download');
    return Buffer.from(await res.arrayBuffer());
  }
}
