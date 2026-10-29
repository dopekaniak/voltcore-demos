import { describe, expect, it } from 'vitest';
import { isForward, MeshyProvider, MockProvider, ProviderError } from '../src/index';

describe('MockProvider', () => {
  let t = 1_000_000;
  const mock = new MockProvider({ meshUrl: 'http://mesh', meshToken: 'tok', webhookSecret: 'secret', latencyMs: [8000, 25000], now: () => t });

  it('simulates 8-25 s of latency and moves QUEUED → RUNNING → SUCCEEDED', async () => {
    const { providerTaskId } = await mock.createTask({ kind: 'preview', modelCode: 'mock-standard', prompt: 'a vase' }, { idempotencyKey: 'k1' });
    const q = await mock.getTask(providerTaskId);
    expect(q.status).toBe('QUEUED');
    t += 5000;
    const r = await mock.getTask(providerTaskId);
    expect(r.status).toBe('RUNNING');
    expect(r.progress).toBeGreaterThan(0);
    t += 30000;
    const s = await mock.getTask(providerTaskId);
    expect(s.status).toBe('SUCCEEDED');
    expect(s.outputs.glb).toMatch(/^http:\/\/mesh\/samples\/\w+\?format=glb&textured=false$/);
  });

  it('is deterministic for the same prompt and key, and refine keeps the shape', async () => {
    const a = await mock.createTask({ kind: 'preview', modelCode: 'm', prompt: 'a vase' }, { idempotencyKey: 'same' });
    const b = await mock.createTask({ kind: 'preview', modelCode: 'm', prompt: 'a vase' }, { idempotencyKey: 'same' });
    expect(a.providerTaskId.split('_').at(-1)).toBe(b.providerTaskId.split('_').at(-1));
    const refine = await mock.createTask({ kind: 'refine', modelCode: 'm', previewTaskId: a.providerTaskId }, { idempotencyKey: 'r' });
    t += 60000;
    const pa = await mock.getTask(a.providerTaskId);
    const pr = await mock.getTask(refine.providerTaskId);
    expect(pr.outputs.stl).toBe(pa.outputs.stl);
    expect(pr.outputs.glb).toContain('textured=true');
  });

  it('fails tasks whose prompt asks for it', async () => {
    const { providerTaskId } = await mock.createTask({ kind: 'preview', modelCode: 'm', prompt: 'x [[fail]]' }, { idempotencyKey: 'f' });
    t += 60000;
    expect((await mock.getTask(providerTaskId)).status).toBe('FAILED');
  });

  it('signs webhooks and parses them; tampered bodies fail verification', () => {
    const [d] = mock.webhookDeliveries('mock_x_00000000');
    const h = new Headers(d!.headers);
    expect(mock.verifyWebhook(h, Buffer.from(d!.body))).toBe(true);
    expect(mock.verifyWebhook(h, Buffer.from(d!.body.replace('50', '51')))).toBe(false);
    expect(mock.parseWebhook(h, Buffer.from(d!.body))?.eventKey).toBe('mock_x_00000000:RUNNING');
    expect(mock.parseWebhook(h, Buffer.from('not json'))).toBeNull();
  });

  it('replays deliveries out of order and duplicated', () => {
    const d = mock.webhookDeliveries('mock_y_00000000').map((x) => JSON.parse(x.body).status);
    expect(d).toEqual(['RUNNING', 'SUCCEEDED', 'SUCCEEDED', 'RUNNING']);
  });
});

describe('forward-only state', () => {
  it('never lets a late in-progress event overwrite a final state', () => {
    expect(isForward({ status: 'RUNNING', progress: 50 }, { status: 'SUCCEEDED', progress: 100 })).toBe(true);
    expect(isForward({ status: 'SUCCEEDED', progress: 100 }, { status: 'RUNNING', progress: 50 })).toBe(false);
    expect(isForward({ status: 'RUNNING', progress: 60 }, { status: 'RUNNING', progress: 50 })).toBe(false);
    expect(isForward({ status: 'QUEUED', progress: 0 }, { status: 'RUNNING', progress: 1 })).toBe(true);
    expect(isForward({ status: 'FAILED', progress: 0 }, { status: 'SUCCEEDED', progress: 100 })).toBe(false);
  });
});

describe('MeshyProvider (stubbed HTTP)', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let next: () => Response | Promise<Response> = () => reply(202, { result: 'task-1' });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return next();
  }) as unknown as typeof fetch;
  const meshy = new MeshyProvider({ apiKey: 'msy_test', baseUrl: 'https://api.example/openapi', fetchImpl });

  it('creates a preview with the documented body and bearer auth', async () => {
    const r = await meshy.createTask({ kind: 'preview', modelCode: 'meshy-6', prompt: 'a monster mask', topology: 'triangle', polycount: 30000 });
    expect(r.providerTaskId).toBe('task-1');
    const c = calls.at(-1)!;
    expect(c.url).toBe('https://api.example/openapi/v2/text-to-3d');
    expect((c.init.headers as Record<string, string>).authorization).toBe('Bearer msy_test');
    expect(JSON.parse(String(c.init.body))).toEqual({ mode: 'preview', prompt: 'a monster mask', ai_model: 'meshy-6', should_remesh: true, topology: 'triangle', target_polycount: 30000 });
  });

  it('creates a refine from a preview task id', async () => {
    await meshy.createTask({ kind: 'refine', modelCode: 'meshy-6', previewTaskId: 'p1' });
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ mode: 'refine', preview_task_id: 'p1' });
  });

  it('treats 5xx and timeouts as uncertain (never resent) and 4xx as rejected', async () => {
    next = () => reply(503, {});
    await expect(meshy.createTask({ kind: 'preview', modelCode: 'meshy-6', prompt: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_CREATE_UNCERTAIN', retryable: false });
    next = () => reply(400, { message: 'bad' });
    await expect(meshy.createTask({ kind: 'preview', modelCode: 'meshy-6', prompt: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
    next = () => Promise.reject(new Error('socket hang up'));
    await expect(meshy.createTask({ kind: 'preview', modelCode: 'meshy-6', prompt: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_CREATE_UNCERTAIN' });
  });

  it('normalizes the task object', async () => {
    next = () => reply(200, { id: 't', status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://assets.example/a.glb', stl: '' }, thumbnail_url: 'https://assets.example/t.png' });
    expect(await meshy.getTask('t')).toEqual({ id: 't', status: 'SUCCEEDED', progress: 100, outputs: { glb: 'https://assets.example/a.glb', thumbnail: 'https://assets.example/t.png' }, error: null });
    next = () => reply(200, { id: 't', status: 'PENDING', progress: 0 });
    expect((await meshy.getTask('t')).status).toBe('QUEUED');
    next = () => reply(200, { id: 't', status: 'FAILED', task_error: { message: 'nope' } });
    expect((await meshy.getTask('t')).error).toEqual({ code: 'PROVIDER_TASK_FAILED', message: 'nope' });
  });

  it('never trusts webhook bodies (no documented signature) but extracts the dedupe key', () => {
    const body = Buffer.from(JSON.stringify({ id: 't', status: 'IN_PROGRESS', progress: 50 }));
    expect(meshy.verifyWebhook()).toBe(false);
    expect(meshy.parseWebhook(new Headers(), body)?.eventKey).toBe('t:IN_PROGRESS');
  });

  it('refuses unsupported operations with NOT_IMPLEMENTED', async () => {
    await expect(meshy.createTask({ kind: 'image', modelCode: 'meshy-6', imageUrls: ['https://x'] })).rejects.toBeInstanceOf(ProviderError);
  });
});
