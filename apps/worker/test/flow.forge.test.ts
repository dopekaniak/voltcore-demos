import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, bearer, makeTestApp, signIn } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { fsStorage } from '@sw/storage';
import { dispatchForge } from '../src/dispatch';
import { makeWorkerCtx } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const w = makeWorkerCtx();
beforeAll(async () => {
  t = await makeTestApp({ STORAGE_DIR: w.env.STORAGE_DIR });
  (w as { storage: unknown }).storage = fsStorage({ dir: w.env.STORAGE_DIR, secret: w.env.APP_SECRET, publicBase: w.env.PUBLIC_FILES_BASE });
});
afterAll(async () => {
  await t.close();
  await w.close();
});

const runJob = async (apiJobId: string) => dispatchForge(w, fromApiId('job', apiJobId)!);

describe('forge API flow', () => {
  it('J1 backend: describe a part → job → forge → change params → export STL', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const noKey = await call('POST', '/v1/forges', { prompt: 'a 40 mm cable clip for a 6 mm cable' });
    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const res = await call('POST', '/v1/forges', { prompt: 'a 40 mm cable clip for a 6 mm cable' }, { 'idempotency-key': 'test-key-forge-create-1' });
    expect(res.statusCode).toBe(202);
    const job = res.json().job;
    expect(job).toMatchObject({ kind: 'FORGE_BUILD', status: 'QUEUED', reserved_credits: 10, forge_state: 'DRAFT' });
    const replay = await call('POST', '/v1/forges', { prompt: 'a 40 mm cable clip for a 6 mm cable' }, { 'idempotency-key': 'test-key-forge-create-1' });
    expect(replay.json().job.id).toBe(job.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const reused = await call('POST', '/v1/forges', { prompt: 'a different part' }, { 'idempotency-key': 'test-key-forge-create-1' });
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    await runJob(job.id);
    const done = (await call('GET', `/v1/jobs/${job.id}`)).json();
    expect(done).toMatchObject({ status: 'SUCCEEDED', progress: 100, committed_credits: 10, forge_state: 'READY' });
    const forgeId = done.output.forge_id as string;
    expect(forgeId).toMatch(/^frg_/);

    const forge = (await call('GET', `/v1/forges/${forgeId}`)).json();
    expect(forge.is_owner).toBe(true);
    expect(forge.version.params.width).toBe(40);
    expect(forge.source.schema.cable).toMatchObject({ type: 'number', min: 2, max: 20 });
    expect(forge.source.code).toContain('export default');
    expect(forge.version.checks_failing).toBe(false);

    const patched = await call('PATCH', `/v1/forges/${forgeId}/params`, { params: { cable: 99, width: 12, bogus: 1 } });
    expect(patched.statusCode).toBe(202);
    const pb = patched.json();
    expect(pb.params).toMatchObject({ cable: 20, width: 12 });
    expect(pb.clamped[0]).toMatchObject({ key: 'cable', reason: 'above-max', message: 'Cable diameter was lowered to the maximum, 20 mm.' });
    expect(pb.unknown).toEqual(['bogus']);
    await runJob(pb.job.id);
    const meshJob = (await call('GET', `/v1/jobs/${pb.job.id}`)).json();
    expect(meshJob.status).toBe('SUCCEEDED');

    const exp = await call('POST', `/v1/forges/${forgeId}/exports`, { format: 'stl', params: { width: 15 } }, { 'idempotency-key': 'test-key-export-stl-1' });
    expect(exp.statusCode).toBe(202);
    await runJob(exp.json().job.id);
    const ej = (await call('GET', `/v1/jobs/${exp.json().job.id}`)).json();
    expect(ej.output.file_id).toMatch(/^fil_/);
    const link = await call('GET', `/v1/assets/${forge.asset_id}/files/${ej.output.file_id}/url`);
    expect(link.statusCode).toBe(200);
    const { url, expires_at } = link.json();
    expect(new Date(expires_at).getTime() - Date.now()).toBeLessThanOrEqual(300_000 + 1000);
    const path = new URL(url);
    const file = await t.app.inject({ method: 'GET', url: path.pathname.replace(/^\/api/, '') + path.search });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toContain('.stl');
    expect(file.rawPayload.readUInt32LE(80) * 50 + 84).toBe(file.rawPayload.length);
    const tampered = await t.app.inject({ method: 'GET', url: path.pathname.replace(/^\/api/, '') + path.search.replace(/sig=../, 'sig=00') });
    expect(tampered.statusCode).toBe(404);

    const wallet = (await call('GET', '/v1/billing/wallet')).json();
    expect(wallet).toMatchObject({ balance: 90, reserved: 0 });
  });

  it('streams job events over SSE and resumes from Last-Event-ID', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const created = await call('POST', '/v1/forges', { starter_key: 'planter' }, { 'idempotency-key': 'test-key-sse-1' });
    if (!created.json().job) throw new Error(created.body);
    const job = created.json().job;
    await runJob(job.id);
    const sse = await call('GET', `/v1/jobs/${job.id}/events`);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const ids = [...sse.body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(5);
    expect(sse.body).toContain('event: end');
    expect(sse.body).toContain('"to":"READY"');
    const resumed = await call('GET', `/v1/jobs/${job.id}/events`, undefined, { 'last-event-id': String(ids[ids.length - 2]) });
    const ids2 = [...resumed.body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids2).toEqual([ids[ids.length - 1]]);
  });

  it('cancels a queued job and refunds; retries a failed one as a new job', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const job = (await call('POST', '/v1/forges', { prompt: 'cable clip' }, { 'idempotency-key': 'test-key-cancel-1' })).json().job;
    expect((await call('GET', '/v1/billing/wallet')).json().reserved).toBe(10);
    const canceled = await call('POST', `/v1/jobs/${job.id}/cancel`);
    expect(canceled.json().status).toBe('CANCELED');
    expect((await call('GET', '/v1/billing/wallet')).json()).toMatchObject({ balance: 100, reserved: 0 });
    await runJob(job.id); // a worker picking it up later does nothing
    expect((await call('GET', `/v1/jobs/${job.id}`)).json().status).toBe('CANCELED');

    const bad = (await call('POST', '/v1/forges', { prompt: 'box [[broken-always]]' }, { 'idempotency-key': 'test-key-retry-1' })).json().job;
    await runJob(bad.id);
    expect((await call('GET', `/v1/jobs/${bad.id}`)).json()).toMatchObject({ status: 'FAILED', error: { code: 'FORGE_BUILD_FAILED' }, committed_credits: 0 });
    const retry = await call('POST', `/v1/jobs/${bad.id}/retry`, undefined, { 'idempotency-key': 'test-key-retry-1-again' });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ status: 'QUEUED', reserved_credits: 10 });
  });

  it('IDOR: another user cannot read or change a forge, its files, or its jobs', async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const job = (await as(t, b.cookie)('POST', '/v1/forges', { starter_key: 'cable-clip' }, { 'idempotency-key': 'test-key-idor-1' })).json().job;
    await runJob(job.id);
    const forge = (await as(t, b.cookie)('GET', `/v1/forges/${(await as(t, b.cookie)('GET', `/v1/jobs/${job.id}`)).json().output.forge_id}`)).json();
    const callA = as(t, a.cookie);
    expect((await callA('GET', `/v1/forges/${forge.id}`)).statusCode).toBe(404);
    expect((await callA('GET', `/v1/forges/${forge.id}/versions`)).statusCode).toBe(404);
    expect((await callA('PATCH', `/v1/forges/${forge.id}/params`, { params: {} })).statusCode).toBe(404);
    expect((await callA('POST', `/v1/forges/${forge.id}/exports`, { format: 'stl' }, { 'idempotency-key': 'test-key-idor-exp' })).statusCode).toBe(404);
    expect((await callA('GET', `/v1/jobs/${job.id}`)).statusCode).toBe(404);
    expect((await callA('POST', `/v1/jobs/${job.id}/cancel`)).statusCode).toBe(404);
    expect((await callA('GET', `/v1/jobs/${job.id}/events`)).statusCode).toBe(404);
    expect((await callA('GET', `/v1/assets/${forge.asset_id}/files/${forge.files.thumbnail}/url`)).statusCode).toBe(404);
    // anonymous too
    expect((await t.app.inject({ method: 'GET', url: `/v1/forges/${forge.id}` })).statusCode).toBe(404);
  });

  it('API keys need the forge:write scope to create forges', async () => {
    const s = await signIn(t);
    const { key } = (await as(t, s.cookie)('POST', '/v1/api-keys', { name: 'r', scopes: ['forge:read'] })).json();
    const r = await bearer(t, key)('POST', '/v1/forges', { prompt: 'cable clip' }, { 'idempotency-key': 'test-key-scope-1' });
    expect(r.json().error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('serves starters publicly', async () => {
    const list = (await t.app.inject({ method: 'GET', url: '/v1/forges/starters' })).json();
    expect(list.data.map((s: { key: string }) => s.key)).toEqual(['cable-clip', 'box-with-lid', 'planter', 'filleted-box', 'fan-bracket']);
    const one = (await t.app.inject({ method: 'GET', url: '/v1/forges/starters/planter' })).json();
    expect(one.code).toContain('export default');
  });
});
