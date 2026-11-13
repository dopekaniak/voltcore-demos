import { describe, expect, it } from 'vitest';
import { ProviderError, SelfHostProvider, providerRegistry } from '../src/index';

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    const c = { url: String(url), init };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('SelfHostProvider', () => {
  it('sends a text preview with the bearer token and an idempotency key', async () => {
    const { f, calls } = fakeFetch(() => json(201, { id: 'gt_1', status: 'QUEUED' }));
    const p = new SelfHostProvider({ baseUrl: 'http://gen:8100/', token: 'secret-token-123456', fetchImpl: f });
    const r = await p.createTask({ kind: 'preview', modelCode: 'studio-shape-v1', prompt: 'a dragon phone stand' }, { idempotencyKey: 'job_9' });
    expect(r.providerTaskId).toBe('gt_1');
    expect(calls[0]!.url).toBe('http://gen:8100/v1/tasks');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer secret-token-123456');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ kind: 'text', prompt: 'a dragon phone stand', quality: 'draft', idempotency_key: 'selfhost:job_9' });
  });

  it('maps refine and image inputs; refuses retexture', async () => {
    const { f, calls } = fakeFetch(() => json(201, { id: 'gt_2', status: 'QUEUED' }));
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: f });
    await p.createTask({ kind: 'refine', modelCode: 'm', previewTaskId: 'gt_1' }, { idempotencyKey: 'a' });
    await p.createTask({ kind: 'image', modelCode: 'm', imageUrls: ['https://files/x.png'], removeBackground: false }, { idempotencyKey: 'b' });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ kind: 'refine', parent_id: 'gt_1' });
    expect(JSON.parse(calls[1]!.init.body as string)).toMatchObject({ kind: 'image', image_url: 'https://files/x.png', remove_background: false });
    await expect(p.createTask({ kind: 'retexture', modelCode: 'm', texturePrompt: 'red' }, { idempotencyKey: 'c' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('resends a create once after a 5xx (the server dedupes), but not after a 4xx', async () => {
    let n = 0;
    const flaky = fakeFetch(() => (++n === 1 ? json(503, { error: { message: 'busy' } }) : json(201, { id: 'gt_3' })));
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: flaky.f });
    expect((await p.createTask({ kind: 'preview', modelCode: 'm', prompt: 'x' }, { idempotencyKey: 'k' })).providerTaskId).toBe('gt_3');
    expect(new Set(flaky.calls.map((c) => c.init.body)).size).toBe(1);

    const bad = fakeFetch(() => json(422, { error: { message: 'prompt is required' } }));
    const q = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: bad.f });
    const err = await q.createTask({ kind: 'preview', modelCode: 'm', prompt: ' ' }, { idempotencyKey: 'k' }).then(() => null, (e: unknown) => e as ProviderError);
    expect(err).toBeInstanceOf(ProviderError);
    if (!err) return;
    expect(err.message).toContain('prompt is required');
    expect(err.retryable).toBe(false);
    expect(bad.calls).toHaveLength(1);
  });

  it('normalizes task status and makes output URLs absolute', async () => {
    const { f } = fakeFetch(() => json(200, { id: 'gt_4', status: 'SUCCEEDED', progress: 100, outputs: { glb: '/v1/tasks/gt_4/files/glb', stl: '/v1/tasks/gt_4/files/stl' } }));
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: f });
    expect(await p.getTask('gt_4')).toEqual({ id: 'gt_4', status: 'SUCCEEDED', progress: 100, outputs: { glb: 'http://gen/v1/tasks/gt_4/files/glb', stl: 'http://gen/v1/tasks/gt_4/files/stl' }, error: null });
  });

  it('reports failures with the server message', async () => {
    const { f } = fakeFetch(() => json(200, { id: 'gt_5', status: 'FAILED', progress: 40, error: { code: 'GENERATION_FAILED', message: 'CUDA out of memory' } }));
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: f });
    expect((await p.getTask('gt_5')).error).toEqual({ code: 'GENERATION_FAILED', message: 'CUDA out of memory' });
  });

  it('treats an unreachable server as retryable', async () => {
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(p.getTask('gt_6')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
  });

  it('downloads only from the configured server', async () => {
    const { f, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3])));
    const p = new SelfHostProvider({ baseUrl: 'http://gen', token: 't'.repeat(16), fetchImpl: f });
    expect([...(await p.download('http://gen/v1/tasks/gt_7/files/glb'))]).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe('http://gen/v1/tasks/gt_7/files/glb');
    await expect(p.download('http://evil/v1/tasks/x')).rejects.toBeInstanceOf(ProviderError);
    await expect(p.download('http://gen.evil/v1/tasks/x')).rejects.toBeInstanceOf(ProviderError);
  });

  it('is registered only when the server URL and token are set', () => {
    const base = { PROVIDER_MODE: 'mock' as const, MESHY_BASE_URL: 'https://x', MESH_URL: 'http://mesh', MESH_SERVICE_TOKEN: 'tok', APP_SECRET: 'dev-secret-0123456789abcdef', MOCK_PROVIDER_LATENCY_MS: '10-20' };
    expect(providerRegistry(base).has('selfhost')).toBe(false);
    expect(providerRegistry({ ...base, GEN_SERVER_URL: 'http://gen', GEN_SERVER_TOKEN: 't'.repeat(16) }).get('selfhost')).toBeInstanceOf(SelfHostProvider);
  });
});
