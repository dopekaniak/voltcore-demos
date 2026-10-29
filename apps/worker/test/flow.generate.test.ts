import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn, ORIGIN } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { MeshClient } from '@sw/shared/node';
import { type MockProvider, providerRegistry } from '@sw/providers';
import { fsStorage } from '@sw/storage';
import { dispatchMesh } from '../src/dispatch';
import { processGeneration } from '../src/processors/generation';
import { makeWorkerCtx } from './helpers';
import { startMeshService } from './mesh-service';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const w = makeWorkerCtx();
let mesh: { url: string; stop: () => void };
beforeAll(async () => {
  mesh = await startMeshService();
  t = await makeTestApp({ STORAGE_DIR: w.env.STORAGE_DIR, MESH_URL: mesh.url, MOCK_PROVIDER_LATENCY_MS: '200-400' });
  t.ctx.mesh = new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN });
  t.ctx.providers = providerRegistry({ ...t.ctx.env, MESH_URL: mesh.url, MOCK_PROVIDER_LATENCY_MS: '200-400' });
  Object.assign(w, {
    storage: fsStorage({ dir: w.env.STORAGE_DIR, secret: w.env.APP_SECRET, publicBase: w.env.PUBLIC_FILES_BASE }),
    mesh: new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN }),
    providers: providerRegistry({ ...w.env, MESH_URL: mesh.url, MOCK_PROVIDER_LATENCY_MS: '200-400' }),
  });
}, 60_000);
afterAll(async () => {
  await t.close();
  await w.close();
  mesh.stop();
});
const key = () => `k-${crypto.randomUUID()}`;

/** Drive a generation job like the queue would: start, then poll until final. */
async function runGen(apiJobId: string) {
  const id = fromApiId('job', apiJobId)!;
  await processGeneration(w, { jobId: id });
  for (let i = 0; i < 100; i++) {
    const j = await w.db.job.findUniqueOrThrow({ where: { id } });
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 60));
    await w.db.job.update({ where: { id }, data: { lockedAt: null } });
    await processGeneration(w, { jobId: id, poll: true });
  }
  throw new Error('job did not finish');
}

describe('Generate (mock provider)', () => {
  it('J4 backend: preview → refine → GLB download; costs committed; library shows both versions', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const models = (await t.app.inject({ method: 'GET', url: '/v1/models' })).json().data;
    expect(models.map((m: { code: string }) => m.code)).toEqual(['mock-standard', 'mock-lite']);
    expect((await t.app.inject({ method: 'GET', url: '/v1/estimates?kind=preview&model=mock-standard' })).json().credits).toBe(20);

    const pv = await call('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a small ceramic vase', style: 'realistic' }, { 'idempotency-key': key() });
    expect(pv.statusCode).toBe(202);
    const previewJob = pv.json().job;
    expect(previewJob).toMatchObject({ kind: 'GENERATE', reserved_credits: 20 });
    const early = await call('POST', '/v1/generations/text-to-3d', { mode: 'refine', preview_job_id: previewJob.id }, { 'idempotency-key': key() });
    expect(early.json().error.code).toBe('PREVIEW_NOT_READY');

    const done = await runGen(previewJob.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.committedCredits).toBe(20);
    const assetId = (await call('GET', `/v1/jobs/${previewJob.id}`)).json().output.asset_id;
    const rf = await call('POST', '/v1/generations/text-to-3d', { mode: 'refine', preview_job_id: previewJob.id }, { 'idempotency-key': key() });
    expect(rf.statusCode).toBe(202);
    await runGen(rf.json().job.id);

    const asset = (await call('GET', `/v1/assets/${assetId}`)).json();
    expect(asset.kind).toBe('GENERATED');
    expect(asset.versions.map((v: { stage: string }) => v.stage)).toEqual(['REFINED', 'PREVIEW']);
    const refined = asset.versions[0];
    expect(refined.parent_version_id).toBe(asset.versions[1].id);
    expect(refined.analysis.watertight).toBe(true);
    expect(refined.files.map((f: { role: string }) => f.role).sort()).toEqual(['GLB', 'STL']);
    const glb = refined.files.find((f: { role: string }) => f.role === 'GLB');
    const link = (await call('GET', `/v1/assets/${assetId}/files/${glb.id}/url`)).json();
    const u = new URL(link.url);
    const file = await t.app.inject({ method: 'GET', url: u.pathname.replace(/^\/api/, '') + u.search });
    expect(file.rawPayload.subarray(0, 4).toString()).toBe('glTF');
    expect((await call('GET', '/v1/billing/wallet')).json().balance).toBe(70);

    const lib = (await call('GET', '/v1/assets?kind=GENERATED&q=vase')).json();
    expect(lib.data.map((a: { id: string }) => a.id)).toContain(assetId);
    expect((await call('GET', '/v1/assets?q=nothing-matches-this')).json().data).toEqual([]);
  });

  it('a failed job is not charged', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const r = await call('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a lamp [[fail]]' }, { 'idempotency-key': key() });
    expect((await call('GET', '/v1/billing/wallet')).json()).toMatchObject({ balance: 100, reserved: 20 });
    const j = await runGen(r.json().job.id);
    expect(j.status).toBe('FAILED');
    expect(j.errorCode).toBe('MOCK_FAILURE');
    expect((await call('GET', '/v1/billing/wallet')).json()).toMatchObject({ balance: 100, reserved: 0 });
  });

  it('a canceled job is refunded', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const r = await call('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a cube' }, { 'idempotency-key': key() });
    await processGeneration(w, { jobId: fromApiId('job', r.json().job.id)! });
    expect((await call('POST', `/v1/jobs/${r.json().job.id}/cancel`)).json().status).toBe('CANCELED');
    expect((await call('GET', '/v1/billing/wallet')).json()).toMatchObject({ balance: 100, reserved: 0 });
  });

  it('refuses prohibited prompts', async () => {
    const s = await signIn(t);
    const r = await as(t, s.cookie)('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a pistol grip for a handgun' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('PROHIBITED_ITEM');
    expect((await as(t, s.cookie)('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a magazine rack for the living room' }, { 'idempotency-key': key() })).statusCode).toBe(202);
  });

  it('repairs and remeshes into new versions without overwriting the original', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const r = await call('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a gem' }, { 'idempotency-key': key() });
    await runGen(r.json().job.id);
    const assetId = (await call('GET', `/v1/jobs/${r.json().job.id}`)).json().output.asset_id;
    const v1 = (await call('GET', `/v1/assets/${assetId}`)).json().versions[0];
    const rep = await call('POST', `/v1/assets/${assetId}/versions/${v1.id}/repair`, undefined, { 'idempotency-key': key() });
    await dispatchMesh(w, fromApiId('job', rep.json().job.id)!);
    const rm = await call('POST', '/v1/generations/remesh', { asset_version_id: v1.id, target_faces: 100 }, { 'idempotency-key': key() });
    await dispatchMesh(w, fromApiId('job', rm.json().job.id)!);
    const versions = (await call('GET', `/v1/assets/${assetId}`)).json().versions;
    expect(versions.map((v: { stage: string }) => v.stage)).toEqual(['REMESHED', 'REPAIRED', 'PREVIEW']);
    expect(versions[2].id).toBe(v1.id);
    expect(versions[1].analysis.actions.length).toBeGreaterThan(0);
  });
});

describe('provider webhooks', () => {
  it('verifies, dedupes, and ignores out-of-order deliveries; the worker fetches back', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const r = await call('POST', '/v1/generations/text-to-3d', { mode: 'preview', prompt: 'a tower' }, { 'idempotency-key': key() });
    const id = fromApiId('job', r.json().job.id)!;
    await processGeneration(w, { jobId: id });
    const job = await w.db.job.findUniqueOrThrow({ where: { id } });
    const mock = t.ctx.providers.get('mock') as MockProvider;
    const post = (d: { headers: Record<string, string>; body: string }) => t.app.inject({ method: 'POST', url: '/internal/providers/mock/webhook', headers: d.headers, payload: d.body });
    const [progress, final, dup, late] = mock.webhookDeliveries(job.providerTaskId!);
    expect((await post(progress!)).json()).toMatchObject({ duplicate: false, matched: true });
    expect((await post(final!)).json()).toMatchObject({ duplicate: false });
    expect((await post(dup!)).json()).toMatchObject({ duplicate: true });
    expect((await post(late!)).json()).toMatchObject({ duplicate: true });
    const bad = await t.app.inject({ method: 'POST', url: '/internal/providers/mock/webhook', headers: { ...final!.headers, 'x-mock-signature': '00' }, payload: final!.body });
    expect(bad.json().error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await t.app.inject({ method: 'POST', url: '/internal/providers/nope/webhook', payload: '{}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(404);
    const polls = await w.db.outboxMessage.count({ where: { topic: 'generation', key: { startsWith: `${id}:wh:` } } });
    expect(polls).toBe(2);
    // Even after the SUCCEEDED delivery the job only finishes when the provider confirms.
    const done = await runGen(r.json().job.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.progress).toBe(100);
  });
});

describe('uploads', () => {
  async function upload(cookie: string | null, name: string, type: string, body: Buffer, purpose: 'print' | 'image') {
    const headers: Record<string, string> = { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
    const res = await t.app.inject({ method: 'POST', url: '/v1/uploads', headers, payload: { filename: name, content_type: type, bytes: body.length, purpose } });
    const created = res.json();
    const anonCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sw_anon='))?.split(';')[0];
    const c = cookie ?? anonCookie ?? '';
    const u = new URL(created.put.url);
    const put = await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': type }, payload: body });
    const done = await t.app.inject({ method: 'POST', url: `/v1/uploads/${created.upload.id}/complete`, headers: { origin: ORIGIN, cookie: c } });
    return { created, put, done, cookie: c };
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

  it('accepts a real PNG and an STL, and rejects mismatched contents', async () => {
    const s = await signIn(t);
    const ok = await upload(s.cookie, 'photo.png', 'image/png', png, 'image');
    expect(ok.put.statusCode).toBe(200);
    expect(ok.done.json().upload.status).toBe('CLEAN');
    const fake = await upload(s.cookie, 'photo.png', 'image/png', Buffer.from('not an image at all, just text'), 'image');
    expect(fake.done.json().error.code).toBe('UPLOAD_REJECTED');
    const stlBody = await (await fetch(`${mesh.url}/samples/gem?format=stl`, { headers: { authorization: `Bearer ${w.env.MESH_SERVICE_TOKEN}` } })).arrayBuffer();
    const anon = await upload(null, 'gem.stl', 'model/stl', Buffer.from(stlBody), 'print');
    expect(anon.done.json().analysis.watertight).toBe(true);
  });

  it('rejects wrong types, oversize files, and tampered PUTs', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    expect((await call('POST', '/v1/uploads', { filename: 'x.exe', content_type: 'application/octet-stream', bytes: 10, purpose: 'print' })).json().error.code).toBe('UPLOAD_REJECTED');
    expect((await call('POST', '/v1/uploads', { filename: 'x.png', content_type: 'image/png', bytes: 21 * 1024 * 1024, purpose: 'image' })).json().error.code).toBe('UPLOAD_REJECTED');
    const c = (await call('POST', '/v1/uploads', { filename: 'x.png', content_type: 'image/png', bytes: png.length, purpose: 'image' })).json();
    const u = new URL(c.put.url);
    const path = u.pathname.replace(/^\/api/, '');
    expect((await t.app.inject({ method: 'PUT', url: path + u.search, headers: { 'content-type': 'image/png' }, payload: Buffer.concat([png, Buffer.from('x')]) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'PUT', url: path + u.search, headers: { 'content-type': 'image/jpeg' }, payload: png })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'PUT', url: path + u.search.replace('sig=', 'sig=0'), headers: { 'content-type': 'image/png' }, payload: png })).statusCode).toBe(403);
  });

  it('image to 3D uses clean uploads you own', async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const up = await upload(a.cookie, 'p.png', 'image/png', png, 'image');
    const id = up.created.upload.id;
    expect((await as(t, b.cookie)('POST', '/v1/generations/image-to-3d', { upload_ids: [id] }, { 'idempotency-key': key() })).statusCode).toBe(404);
    const r = await as(t, a.cookie)('POST', '/v1/generations/image-to-3d', { upload_ids: [id], title: 'Chair from photo' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(202);
    expect((await runGen(r.json().job.id)).status).toBe('SUCCEEDED');
    // IDOR on uploads and assets
    expect((await t.app.inject({ method: 'POST', url: `/v1/uploads/${id}/complete`, headers: { origin: ORIGIN, cookie: b.cookie } })).statusCode).toBe(404);
    const assetId = (await as(t, a.cookie)('GET', `/v1/jobs/${r.json().job.id}`)).json().output.asset_id;
    expect((await as(t, b.cookie)('GET', `/v1/assets/${assetId}`)).statusCode).toBe(404);
    expect((await as(t, b.cookie)('GET', '/v1/assets')).json().data).toEqual([]);
  });
});
