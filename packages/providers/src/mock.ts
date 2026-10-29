import { createHash } from 'node:crypto';
import { hmacHex, safeEqual } from '@sw/shared/node';
import { ProviderError, type Capabilities, type ModelProvider, type NormalizedTask, type ProviderInput } from './types';

export const MOCK_SAMPLES = ['vase', 'mug', 'gem', 'blob', 'tower'] as const;

interface MockTaskState {
  c: number; // created ms
  l: number; // latency ms
  k: ProviderInput['kind'];
  s: (typeof MOCK_SAMPLES)[number];
  f: 0 | 1; // fails
}

/**
 * Deterministic mock provider (build prompt 4.1). Stateless: the task id encodes when the
 * task was created, how long it takes (8-25 s by default), which bundled sample mesh it
 * returns, and whether it fails (a prompt containing `[[fail]]`). Outputs are sample meshes
 * served by the mesh service. Webhook deliveries are HMAC-signed; `webhookDeliveries` makes
 * the duplicate and out-of-order sequences tests need.
 */
export class MockProvider implements ModelProvider {
  readonly key = 'mock';
  constructor(
    private readonly o: { meshUrl: string; meshToken: string; webhookSecret: string; latencyMs: [number, number]; now?: () => number; fetchImpl?: typeof fetch },
  ) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }

  capabilities(): Capabilities {
    return { textTo3D: true, imageTo3D: true, refine: true, retexture: true, remesh: true, webhooks: true, outputs: ['glb', 'obj', 'stl'] };
  }

  async createTask(input: ProviderInput, ctx: { idempotencyKey: string }): Promise<{ providerTaskId: string }> {
    const seedText = input.kind === 'preview' ? input.prompt : input.kind === 'refine' ? input.previewTaskId : input.kind === 'retexture' ? input.texturePrompt : input.imageUrls.join(',');
    const h = createHash('sha256').update(`${seedText}|${ctx.idempotencyKey}`).digest();
    const [lo, hi] = this.o.latencyMs;
    let sample: MockTaskState['s'] = MOCK_SAMPLES[h[0]! % MOCK_SAMPLES.length]!;
    // A refine or retexture keeps the source's shape.
    if (input.kind === 'refine') sample = decode(input.previewTaskId)?.s ?? sample;
    if (input.kind === 'retexture' && input.sourceTaskId) sample = decode(input.sourceTaskId)?.s ?? sample;
    const fails = /\[\[fail\]\]/.test(seedText) ? 1 : 0;
    const state: MockTaskState = { c: this.now(), l: lo + (h.readUInt16BE(1) % Math.max(1, hi - lo + 1)), k: input.kind, s: sample, f: fails };
    return { providerTaskId: `mock_${Buffer.from(JSON.stringify(state)).toString('base64url')}_${h.subarray(4, 8).toString('hex')}` };
  }

  async getTask(id: string): Promise<NormalizedTask> {
    const st = decode(id);
    if (!st) throw new ProviderError('PROVIDER_REJECTED', 'unknown mock task', false, 404);
    const elapsed = this.now() - st.c;
    if (elapsed < st.l * 0.1) return { id, status: 'QUEUED', progress: 0, outputs: {}, error: null };
    if (elapsed < st.l) return { id, status: 'RUNNING', progress: Math.min(99, Math.floor((elapsed / st.l) * 100)), outputs: {}, error: null };
    if (st.f) return { id, status: 'FAILED', progress: 0, outputs: {}, error: { code: 'MOCK_FAILURE', message: 'The mock provider failed this task on purpose.' } };
    const textured = st.k !== 'preview';
    const base = `${this.o.meshUrl}/samples/${st.s}`;
    return {
      id,
      status: 'SUCCEEDED',
      progress: 100,
      outputs: { glb: `${base}?format=glb&textured=${textured}`, stl: `${base}?format=stl`, obj: `${base}?format=obj` },
      error: null,
    };
  }

  async cancelTask(): Promise<void> {
    /* The mock has nothing to stop; the job is canceled on our side. */
  }

  async download(url: string): Promise<Buffer> {
    if (!url.startsWith(this.o.meshUrl)) throw new ProviderError('PROVIDER_ERROR', 'mock outputs come from the mesh service', false);
    const res = await (this.o.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${this.o.meshToken}` } });
    if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `download failed (${res.status})`, true, res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  verifyWebhook(headers: Headers, rawBody: Buffer): boolean {
    const sig = headers.get('x-mock-signature');
    return Boolean(sig) && safeEqual(sig!, hmacHex(this.o.webhookSecret, rawBody));
  }

  parseWebhook(_headers: Headers, rawBody: Buffer): { eventKey: string; task: NormalizedTask } | null {
    try {
      const b = JSON.parse(rawBody.toString('utf8')) as { id?: string; status?: NormalizedTask['status']; progress?: number };
      if (!b.id || !b.status) return null;
      return { eventKey: `${b.id}:${b.status}`, task: { id: b.id, status: b.status, progress: b.progress ?? 0, outputs: {}, error: null } };
    } catch {
      return null;
    }
  }

  /** A signed delivery as the mock would send it. */
  signedDelivery(body: object): { headers: Record<string, string>; body: string } {
    const raw = JSON.stringify(body);
    return { headers: { 'content-type': 'application/json', 'x-mock-signature': hmacHex(this.o.webhookSecret, raw) }, body: raw };
  }

  /** Deliveries for a task: progress, final, a duplicate final, and a late progress event. */
  webhookDeliveries(taskId: string, final: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    return [
      this.signedDelivery({ id: taskId, status: 'RUNNING', progress: 50 }),
      this.signedDelivery({ id: taskId, status: final, progress: final === 'SUCCEEDED' ? 100 : 0 }),
      this.signedDelivery({ id: taskId, status: final, progress: final === 'SUCCEEDED' ? 100 : 0 }),
      this.signedDelivery({ id: taskId, status: 'RUNNING', progress: 50 }),
    ];
  }
}

function decode(id: string): MockTaskState | null {
  const m = /^mock_([A-Za-z0-9_-]+)_[0-9a-f]{8}$/.exec(id);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as MockTaskState;
  } catch {
    return null;
  }
}
