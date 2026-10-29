import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from '@sw/api/testing';
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
const key = () => `k-${crypto.randomUUID()}`;
const run = (jobApiId: string) => dispatchForge(w, fromApiId('job', jobApiId)!);

async function newForge(cookie: string, starter = 'planter') {
  const job = (await as(t, cookie)('POST', '/v1/forges', { starter_key: starter }, { 'idempotency-key': key() })).json().job;
  await run(job.id);
  return (await as(t, cookie)('GET', `/v1/jobs/${job.id}`)).json().output.forge_id as string;
}

describe('versions, forks, and sharing', () => {
  it('saves settings as a new version, keeps the old one, and recomputes checks', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const v1 = (await call('GET', `/v1/forges/${id}`)).json().version;
    const save = await call('POST', `/v1/forges/${id}/versions`, { params: { wall: 0.8, height: 500 } }, { 'idempotency-key': key() });
    expect(save.statusCode).toBe(202);
    expect(save.json().clamped.map((c: { key: string }) => c.key)).toEqual(['height']);
    await run(save.json().job.id);
    const latest = (await call('GET', `/v1/forges/${id}`)).json().version;
    expect(latest.number).toBe(2);
    expect(latest.params).toMatchObject({ wall: 0.8, height: 240 });
    expect(latest.checks_failing).toBe(true);
    expect(latest.checks.find((c: { status: string }) => c.status === 'fail').message).toBe('Wall is 0.8 mm; the printer minimum is 1.2 mm.');
    const old = (await call('GET', `/v1/forges/${id}?version=${v1.id}`)).json().version;
    expect(old.number).toBe(1);
    expect(old.checks_failing).toBe(false);
    const list = (await call('GET', `/v1/forges/${id}/versions`)).json().data;
    expect(list.map((v: { number: number }) => v.number)).toEqual([2, 1]);
  });

  it('forks a forge into a new one the caller owns', async () => {
    const a = await signIn(t);
    const id = await newForge(a.cookie, 'cable-clip');
    const fork = await as(t, a.cookie)('POST', `/v1/forges/${id}/fork`, { params: { width: 30 } }, { 'idempotency-key': key() });
    await run(fork.json().job.id);
    const out = (await as(t, a.cookie)('GET', `/v1/jobs/${fork.json().job.id}`)).json().output;
    const forked = (await as(t, a.cookie)('GET', `/v1/forges/${out.forge_id}`)).json();
    expect(forked.forked_from).toBe(id);
    expect(forked.id).not.toBe(id);
    expect(forked.version).toMatchObject({ number: 1 });
    expect(forked.version.params.width).toBe(30);
    expect(forked.title).toContain('(fork)');
  });

  it('private forges cannot be read or forked by others; unlisted ones can be forked', async () => {
    const owner = await signIn(t);
    const other = await signIn(t);
    const id = await newForge(owner.cookie, 'filleted-box');
    expect((await as(t, other.cookie)('POST', `/v1/forges/${id}/fork`, {}, { 'idempotency-key': key() })).statusCode).toBe(404);
    expect((await as(t, other.cookie)('PATCH', `/v1/assets/${id}`, { visibility: 'PUBLIC' })).statusCode).toBe(404);
    const vis = await as(t, owner.cookie)('PATCH', `/v1/assets/${id}`, { visibility: 'UNLISTED' });
    expect(vis.json().visibility).toBe('UNLISTED');
    const seen = (await as(t, other.cookie)('GET', `/v1/forges/${id}`)).json();
    expect(seen.is_owner).toBe(false);
    // Non-owners cannot change it or export from it.
    expect((await as(t, other.cookie)('POST', `/v1/forges/${id}/versions`, { params: {} }, { 'idempotency-key': key() })).statusCode).toBe(404);
    const fork = await as(t, other.cookie)('POST', `/v1/forges/${id}/fork`, {}, { 'idempotency-key': key() });
    expect(fork.statusCode).toBe(202);
    await run(fork.json().job.id);
    const out = (await as(t, other.cookie)('GET', `/v1/jobs/${fork.json().job.id}`)).json();
    expect(out.status).toBe('SUCCEEDED');
    const audit = await t.ctx.db.auditLog.findFirst({ where: { action: 'asset.visibility', targetId: fromApiId('forge', id)! } });
    expect(audit?.data).toEqual({ from: 'PRIVATE', to: 'UNLISTED' });
  });

  it('deleted forges return 404', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    expect((await as(t, s.cookie)('DELETE', `/v1/assets/${id}`)).statusCode).toBe(200);
    expect((await as(t, s.cookie)('GET', `/v1/forges/${id}`)).statusCode).toBe(404);
  });
});
