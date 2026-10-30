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

type P = [number, number, number];
const rimHits = (n: number) => Array.from({ length: n }, (_, i) => ({ feature: 'rim', point: [52 * Math.cos(i / 3), 52 * Math.sin(i / 3), 87] as P }));
const wallHits = (n: number) => Array.from({ length: n }, (_, i) => ({ feature: 'wall', point: [49 * Math.cos(i / 3), 49 * Math.sin(i / 3), 50] as P }));

describe('named features and region selection (M6-A)', () => {
  it('the build step records each feature with its code range and bounds', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const r = (await as(t, s.cookie)('GET', `/v1/forges/${id}/features`)).json();
    expect(r.featured).toBe(true);
    expect(r.data.map((f: { key: string }) => f.key)).toEqual(['wall', 'cavity', 'rim', 'drain']);
    const rim = r.data.find((f: { key: string }) => f.key === 'rim');
    expect(rim.params).toEqual(['height', 'rim', 'rim_h']);
    expect(rim.bbox_mm.max[2]).toBeCloseTo(90, 1);
    const code = (await as(t, s.cookie)('GET', `/v1/forges/${id}`)).json().source.code as string;
    expect(code.slice(rim.code_range[0], rim.code_range[1])).toMatch(/^\(k, p, d\) => \{[\s\S]*\.label\('rim'\);\n {2}\}$/);
  });

  it('describe a 60 mm fan bracket: builds with named features, runs bed-fit and wall checks, exports STL', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const job = (await call('POST', '/v1/forges', { prompt: 'a bracket for a 60 mm fan' }, { 'idempotency-key': key() })).json().job;
    await run(job.id);
    const id = (await call('GET', `/v1/jobs/${job.id}`)).json().output.forge_id as string;
    const forge = (await call('GET', `/v1/forges/${id}`)).json();
    expect(forge.version.params.fan).toBe(60);
    expect(forge.version.bbox_mm).toEqual([60, 60, 20]);
    const ids = forge.version.checks.map((c: { id: string }) => c.id);
    expect(ids).toContain('bed-fit');
    expect(ids.some((x: string) => x.startsWith('min-wall:'))).toBe(true);
    const feats = (await call('GET', `/v1/forges/${id}/features`)).json();
    expect(feats.data.map((f: { key: string }) => f.key)).toEqual(['plate', 'opening', 'fan_holes', 'flange', 'flange_holes']);
    const exp = await call('POST', `/v1/forges/${id}/exports`, { format: 'stl' }, { 'idempotency-key': key() });
    await run(exp.json().job.id);
    expect((await call('GET', `/v1/jobs/${exp.json().job.id}`)).json().output.file_id).toMatch(/^fil_/);
  });

  it('a circled area on the planter rim resolves to the rim feature', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const r = await as(t, s.cookie)('POST', `/v1/forges/${id}/region-edits`, { hits: [...rimHits(12), ...wallHits(3)] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ target_feature_key: 'rim', feature: { key: 'rim' } });
  });

  it('an ambiguous selection returns candidates to pick from, and a picked key resolves', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const r = await as(t, s.cookie)('POST', `/v1/forges/${id}/region-edits`, { hits: [...rimHits(5), ...wallHits(5)] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('FEATURE_AMBIGUOUS');
    expect(r.json().error.details.candidates.map((c: { key: string }) => c.key).sort()).toEqual(['rim', 'wall']);
    const pick = await as(t, s.cookie)('POST', `/v1/forges/${id}/region-edits`, { feature_key: 'wall' });
    expect(pick.json().target_feature_key).toBe('wall');
  });

  it('a forge without named features says so', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const forgeId = fromApiId('forge', id)!;
    const v = await w.db.assetVersion.findFirst({ where: { assetId: forgeId } });
    await w.db.forgeFeature.deleteMany({ where: { assetVersionId: v!.id } });
    const r = await as(t, s.cookie)('POST', `/v1/forges/${id}/region-edits`, { hits: rimHits(3) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('FORGE_NOT_FEATURED');
  });

  it('only the owner can resolve selections', async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const id = await newForge(a.cookie);
    expect((await as(t, b.cookie)('POST', `/v1/forges/${id}/region-edits`, { feature_key: 'rim' })).statusCode).toBe(404);
  });
});
