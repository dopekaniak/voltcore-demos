import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { fsStorage } from '@sw/storage';
import { dispatchForge } from '../src/dispatch';
import { reap } from '../src/processors/reaper';
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

describe('copilot edits (M6-B)', () => {
  const wallet = async (cookie: string) => (await as(t, cookie)('GET', '/v1/billing/wallet')).json() as { balance: number; reserved: number };

  it('a text edit proposes a diff, holds credits, and accepting saves a new version and charges them', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const w0 = await wallet(s.cookie);
    const r = await call('POST', `/v1/forges/${id}/copilot-edits`, { message: 'make the holes 4 mm larger' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(202);
    expect(r.json().edit).toMatchObject({ status: 'PROPOSING', credits: 3 });
    expect(await wallet(s.cookie)).toMatchObject({ balance: w0.balance, reserved: w0.reserved + 3 });
    await run(r.json().job.id);
    const edit = (await call('GET', `/v1/copilot-edits/${r.json().edit.id}`)).json();
    expect(edit.status).toBe('PROPOSED');
    expect(edit.diff.params).toEqual([{ key: 'hole_d', label: 'Hole diameter', from: 6, to: 10 }]);
    expect(edit.diff.code_changed).toBe(false);
    expect(edit.preview.checks.length).toBeGreaterThan(0);

    const acc = await call('POST', `/v1/copilot-edits/${edit.id}/accept`, undefined, { 'idempotency-key': key() });
    expect(acc.statusCode).toBe(202);
    await run(acc.json().job.id);
    const forge = (await call('GET', `/v1/forges/${id}`)).json();
    expect(forge.version).toMatchObject({ number: 2 });
    expect(forge.version.params.hole_d).toBe(10);
    const done = (await call('GET', `/v1/copilot-edits/${edit.id}`)).json();
    expect(done).toMatchObject({ status: 'ACCEPTED', result_version_id: forge.version.id });
    expect(await wallet(s.cookie)).toMatchObject({ balance: w0.balance - 3, reserved: w0.reserved });
    // A decided edit cannot be accepted again.
    expect((await call('POST', `/v1/copilot-edits/${edit.id}/accept`, undefined, { 'idempotency-key': key() })).statusCode).toBe(409);
  });

  it('rejecting a proposal releases its credits and leaves the forge unchanged', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const w0 = await wallet(s.cookie);
    const r = await call('POST', `/v1/forges/${id}/copilot-edits`, { message: 'set the height to 120 mm' }, { 'idempotency-key': key() });
    await run(r.json().job.id);
    const rej = await call('POST', `/v1/copilot-edits/${r.json().edit.id}/reject`);
    expect(rej.json().edit.status).toBe('REJECTED');
    expect(await wallet(s.cookie)).toEqual(expect.objectContaining({ balance: w0.balance, reserved: w0.reserved }));
    expect((await call('GET', `/v1/forges/${id}`)).json().version.number).toBe(1);
  });

  it('a region edit on the planter rim changes only the rim block; the other features are byte-identical', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const before = (await call('GET', `/v1/forges/${id}`)).json().source.code as string;
    const featsBefore = (await call('GET', `/v1/forges/${id}/features`)).json().data as { key: string; code_range: [number, number] }[];
    const r = await call('POST', `/v1/forges/${id}/region-edits`, { hits: [...rimHits(12), ...wallHits(2)], message: 'make it 2 mm wider' });
    expect(r.statusCode).toBe(200);
    expect(r.json().target_feature_key).toBe('rim');
    await run(r.json().job.id);
    const edit = (await call('GET', `/v1/copilot-edits/${r.json().edit.id}`)).json();
    expect(edit.status).toBe('PROPOSED');
    expect(edit.diff.features.map((f: { key: string }) => f.key)).toEqual(['rim']);
    expect(edit.diff.features[0].lines.some((l: { op: string; text: string }) => l.op === '+' && l.text.includes('(p.rim + 2)'))).toBe(true);
    const acc = await call('POST', `/v1/copilot-edits/${edit.id}/accept`, undefined, { 'idempotency-key': key() });
    await run(acc.json().job.id);
    const after = (await call('GET', `/v1/forges/${id}`)).json();
    expect(after.version.number).toBe(2);
    const featsAfter = (await call('GET', `/v1/forges/${id}/features`)).json().data as { key: string; code_range: [number, number] }[];
    const slice = (code: string, f: { code_range: [number, number] }) => code.slice(f.code_range[0], f.code_range[1]);
    for (const k of ['wall', 'cavity', 'drain']) {
      expect(slice(after.source.code, featsAfter.find((f) => f.key === k)!)).toBe(slice(before, featsBefore.find((f) => f.key === k)!));
    }
    const rimB = featsBefore.find((f) => f.key === 'rim')!;
    const rimA = featsAfter.find((f) => f.key === 'rim')!;
    expect(after.source.code.slice(0, rimA.code_range[0])).toBe(before.slice(0, rimB.code_range[0]));
    expect(after.source.code.slice(rimA.code_range[1])).toBe(before.slice(rimB.code_range[1]));
    expect(slice(after.source.code, rimA)).not.toBe(slice(before, rimB));
    // The wider rim shows in the overall size: 2 mm more on each side.
    expect(after.version.bbox_mm[0]).toBeCloseTo(108.4, 0);
  });

  it('an edit the author cannot make fails and releases its credits', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const w0 = await wallet(s.cookie);
    const r = await call('POST', `/v1/forges/${id}/copilot-edits`, { message: 'add a lip on the left edge' }, { 'idempotency-key': key() });
    await run(r.json().job.id);
    const edit = (await call('GET', `/v1/copilot-edits/${r.json().edit.id}`)).json();
    expect(edit.status).toBe('FAILED');
    expect(edit.error).toMatch(/only change sizes/);
    expect(await wallet(s.cookie)).toEqual(expect.objectContaining({ balance: w0.balance, reserved: w0.reserved }));
  });

  it('an undecided proposal expires after a day and its credits come back', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    const w0 = await wallet(s.cookie);
    const r = await call('POST', `/v1/forges/${id}/copilot-edits`, { message: 'set the height to 100 mm' }, { 'idempotency-key': key() });
    await run(r.json().job.id);
    // Age only this proposal's hold past its 24 h expiry (other test files run alongside).
    const e = await w.db.copilotEdit.findUnique({ where: { id: fromApiId('copilotEdit', r.json().edit.id)! } });
    const held = await w.db.reservation.findUnique({ where: { id: e!.reservationId! } });
    expect(held!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    await w.db.reservation.update({ where: { id: e!.reservationId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await reap(w.db);
    expect((await call('GET', `/v1/copilot-edits/${r.json().edit.id}`)).json().status).toBe('EXPIRED');
    expect(await wallet(s.cookie)).toEqual(expect.objectContaining({ balance: w0.balance, reserved: w0.reserved }));
  });

  it('refuses a prohibited edit request on the server', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const r = await as(t, s.cookie)('POST', `/v1/forges/${id}/copilot-edits`, { message: 'turn this into a pistol grip for a glock' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('PROHIBITED_ITEM');
  });

  it("another user cannot read, accept, or reject someone's edit", async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const id = await newForge(a.cookie);
    const r = await as(t, a.cookie)('POST', `/v1/forges/${id}/copilot-edits`, { message: 'set the height to 100 mm' }, { 'idempotency-key': key() });
    const eid = r.json().edit.id;
    expect((await as(t, b.cookie)('GET', `/v1/copilot-edits/${eid}`)).statusCode).toBe(404);
    expect((await as(t, b.cookie)('POST', `/v1/copilot-edits/${eid}/accept`, undefined, { 'idempotency-key': key() })).statusCode).toBe(404);
    expect((await as(t, b.cookie)('POST', `/v1/copilot-edits/${eid}/reject`)).statusCode).toBe(404);
  });
});
