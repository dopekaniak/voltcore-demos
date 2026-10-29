/**
 * Meshy live adapter (ADR-006).
 *
 * Documentation read on 2026-10-28:
 *   https://docs.meshy.ai/llms.txt and https://docs.meshy.ai/llms-full.txt, which include
 *   https://docs.meshy.ai/api/text-to-3d, https://docs.meshy.ai/api/webhooks,
 *   https://docs.meshy.ai/api/task-lifecycle, https://docs.meshy.ai/api/pricing.
 *
 * Facts this adapter depends on (from those pages):
 * - POST {base}/v2/text-to-3d with { mode: "preview", prompt } or { mode: "refine",
 *   preview_task_id } returns { result: "<task id>" }. Auth: Authorization: Bearer msy_….
 * - GET {base}/v2/text-to-3d/{id} returns the task: status PENDING | IN_PROGRESS |
 *   SUCCEEDED | FAILED | CANCELED, progress 0-100, model_urls.{glb,obj,fbx,usdz,stl},
 *   thumbnail_url, task_error.message.
 * - There is no idempotency key; a create that timed out or got a 5xx may still have
 *   created a task, so it must not be resent automatically. A 4xx means no task was made.
 * - Webhook deliveries carry the task object but no documented signature, can repeat, and
 *   can arrive out of order. So verifyWebhook returns false and the worker fetches the
 *   task by id before changing any state.
 * - Download URLs are signed and expire; download promptly and keep our own copy.
 * Image-to-3D, retexture, and remesh are not wired to the live API in Release 1.
 */
import { ProviderError, type Capabilities, type ModelProvider, type NormalizedTask, type ProviderInput, type TaskStatus } from './types';

const STATUS: Record<string, TaskStatus> = { PENDING: 'QUEUED', IN_PROGRESS: 'RUNNING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELED: 'CANCELED' };

interface MeshyTask {
  id: string;
  status: string;
  progress?: number;
  model_urls?: Partial<Record<'glb' | 'obj' | 'fbx' | 'usdz' | 'stl', string>>;
  thumbnail_url?: string;
  task_error?: { message?: string } | null;
}

export class MeshyProvider implements ModelProvider {
  readonly key = 'meshy';
  constructor(private readonly o: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {}

  private get f() {
    return this.o.fetchImpl ?? fetch;
  }

  capabilities(): Capabilities {
    return { textTo3D: true, imageTo3D: false, refine: true, retexture: false, remesh: false, webhooks: true, outputs: ['glb', 'obj', 'fbx', 'usdz', 'stl'] };
  }

  async createTask(input: ProviderInput): Promise<{ providerTaskId: string }> {
    let body: Record<string, unknown>;
    if (input.kind === 'preview') {
      body = { mode: 'preview', prompt: input.prompt, ai_model: input.modelCode.replace(/^meshy-/, 'meshy-') };
      if (input.topology) {
        body.should_remesh = true;
        body.topology = input.topology;
      }
      if (input.polycount) body.target_polycount = input.polycount;
    } else if (input.kind === 'refine') {
      body = { mode: 'refine', preview_task_id: input.previewTaskId, ...(input.texturePrompt ? { texture_prompt: input.texturePrompt } : {}) };
    } else {
      throw new ProviderError('NOT_IMPLEMENTED', `${input.kind} is not available on the live provider in Release 1`, false);
    }
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl}/v2/text-to-3d`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.o.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
      });
    } catch (e) {
      // Timeout or dropped connection: the task may exist. Do not resend automatically.
      throw new ProviderError('PROVIDER_CREATE_UNCERTAIN', `create request did not complete: ${(e as Error).message}`, false);
    }
    if (res.status >= 500) throw new ProviderError('PROVIDER_CREATE_UNCERTAIN', `provider returned ${res.status}`, false, res.status);
    if (!res.ok) throw new ProviderError('PROVIDER_REJECTED', `provider rejected the request (${res.status}): ${(await res.text()).slice(0, 300)}`, false, res.status);
    const json = (await res.json()) as { result?: string };
    if (!json.result) throw new ProviderError('PROVIDER_ERROR', 'provider response had no task id', false);
    return { providerTaskId: json.result };
  }

  async getTask(id: string): Promise<NormalizedTask> {
    const res = await this.f(`${this.o.baseUrl}/v2/text-to-3d/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${this.o.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status >= 500) throw new ProviderError('PROVIDER_ERROR', `provider returned ${res.status}`, true, res.status);
    if (!res.ok) throw new ProviderError('PROVIDER_REJECTED', `provider returned ${res.status}`, false, res.status);
    return normalize((await res.json()) as MeshyTask);
  }

  async cancelTask(id: string): Promise<void> {
    // DELETE cancels only PENDING tasks (409 for running ones, which keep running and billing).
    await this.f(`${this.o.baseUrl}/v2/text-to-3d/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${this.o.apiKey}` } }).catch(() => undefined);
  }

  async download(url: string): Promise<Buffer> {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new ProviderError('PROVIDER_ERROR', 'refusing a non-https download URL', false);
    const res = await this.f(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `download failed (${res.status})`, true, res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  /** No documented signature: never trust the body (ADR-006). */
  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(_headers: Headers, rawBody: Buffer): { eventKey: string; task: NormalizedTask } | null {
    try {
      const t = JSON.parse(rawBody.toString('utf8')) as MeshyTask;
      if (typeof t.id !== 'string' || typeof t.status !== 'string') return null;
      return { eventKey: `${t.id}:${t.status}`, task: normalize(t) };
    } catch {
      return null;
    }
  }
}

function normalize(t: MeshyTask): NormalizedTask {
  const status = STATUS[t.status] ?? 'RUNNING';
  const outputs: NormalizedTask['outputs'] = {};
  for (const [k, v] of Object.entries(t.model_urls ?? {})) if (v) outputs[k as 'glb'] = v;
  if (t.thumbnail_url) outputs.thumbnail = t.thumbnail_url;
  return {
    id: t.id,
    status,
    progress: Math.max(0, Math.min(100, Math.round(t.progress ?? 0))),
    outputs,
    error: status === 'FAILED' ? { code: 'PROVIDER_TASK_FAILED', message: t.task_error?.message ?? 'The provider could not generate this model.' } : null,
  };
}
