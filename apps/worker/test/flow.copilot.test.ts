import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { as, makeTestApp, ORIGIN, signIn, signInAdmin } from '@sw/api/testing';
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
    expect(forge.source.dimensions.fan).toEqual({ source: 'given' });
    expect(forge.source.dimensions.flange_h).toEqual({ source: 'assumed', confirmed: false });
    expect((await call('POST', `/v1/forges/${id}/exports`, { format: 'stl' }, { 'idempotency-key': key() })).json().error.code).toBe('DIMENSIONS_ASSUMED');
    await call('POST', `/v1/forges/${id}/dimensions/confirm`, {});
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

describe('photo calibration, dimension sources, and printer profiles (M6-C)', () => {
  const photo = readFileSync(new URL('./fixtures/fan-photo.jpg', import.meta.url));
  async function uploadPhoto(cookie: string) {
    const res = await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { origin: ORIGIN, cookie }, payload: { filename: 'fan.jpg', content_type: 'image/jpeg', bytes: photo.length, purpose: 'image' } });
    const created = res.json();
    const u = new URL(created.put.url);
    await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': 'image/jpeg' }, payload: photo });
    const done = await t.app.inject({ method: 'POST', url: `/v1/uploads/${created.upload.id}/complete`, headers: { origin: ORIGIN, cookie } });
    return { id: created.upload.id as string, done: done.json() };
  }
  const setFlag = (enabled: boolean) => w.db.featureFlag.update({ where: { key: 'copilot.photo_calibration' }, data: { enabled } });
  const SQUARE: [[number, number], [number, number]] = [[150, 50], [450, 50]]; // 300 px

  it('image uploads lose their EXIF (camera, GPS) and record the pixel size', async () => {
    const s = await signIn(t);
    const up = await uploadPhoto(s.cookie);
    expect(up.done.analysis).toMatchObject({ width: 600, height: 400 });
    expect(up.done.analysis.metadata_removed).toBeGreaterThan(0);
    const row = await w.db.upload.findUnique({ where: { id: fromApiId('upload', up.id)! } });
    const stored = await w.storage.get(row!.storageKey);
    expect(stored.includes(Buffer.from('Exif'))).toBe(false);
    expect(stored.includes(Buffer.from('TestCam'))).toBe(false);
    expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('photo calibration stays off until the image policy is enabled', async () => {
    await setFlag(false);
    const s = await signIn(t);
    const up = await uploadPhoto(s.cookie);
    const r = await as(t, s.cookie)('POST', '/v1/calibrations', { photo_upload_id: up.id, line_px: SQUARE, real_length_mm: 60 });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FEATURE_DISABLED');
  });

  it('a 60 mm reference edge gives a measured 60 mm dimension; recalibrating to 58 mm updates it and marks dependents for rebuild', async () => {
    await setFlag(true);
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie, 'fan-bracket');
    const up = await uploadPhoto(s.cookie);
    const bad = await call('POST', '/v1/calibrations', { photo_upload_id: up.id, line_px: [[10, 10], [10, 10]], real_length_mm: 60 });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('CALIBRATION_INVALID');
    const outside = await call('POST', '/v1/calibrations', { photo_upload_id: up.id, line_px: [[10, 10], [900, 10]], real_length_mm: 60 });
    expect(outside.json().error.code).toBe('CALIBRATION_INVALID');

    const cal = await call('POST', '/v1/calibrations', { photo_upload_id: up.id, line_px: SQUARE, real_length_mm: 60 });
    expect(cal.statusCode).toBe(201);
    expect(cal.json()).toMatchObject({ mm_per_px: 0.2, source: 'USER_MEASURED' });

    const noCal = await call('POST', `/v1/forges/${id}/measurements`, { key: 'fan', line_px: SQUARE }, { 'idempotency-key': key() });
    expect(noCal.statusCode).toBe(409);
    expect(noCal.json().error.code).toBe('CALIBRATION_REQUIRED');

    // Measure the frame at 80 % of the reference: 48 mm; then the full edge: 60 mm.
    const m1 = await call('POST', `/v1/forges/${id}/measurements`, { key: 'fan', line_px: [[150, 50], [390, 50]], calibration_id: cal.json().id }, { 'idempotency-key': key() });
    expect(m1.json()).toMatchObject({ value_mm: 48, source: 'measured' });
    await run(m1.json().job.id);
    const m2 = await call('POST', `/v1/forges/${id}/measurements`, { key: 'fan', line_px: SQUARE, calibration_id: cal.json().id }, { 'idempotency-key': key() });
    expect(m2.json().value_mm).toBe(60);
    await run(m2.json().job.id);
    const v3 = (await call('GET', `/v1/forges/${id}`)).json();
    expect(v3.version.number).toBe(3);
    expect(v3.version.params.fan).toBe(60);
    expect(v3.source.dimensions.fan).toMatchObject({ source: 'measured', calibration_id: cal.json().id, value_mm: 60 });
    expect(v3.source.dimensions.plate).toEqual({ source: 'default' });

    const re = await call('PATCH', `/v1/calibrations/${cal.json().id}`, { real_length_mm: 58 });
    expect(re.statusCode).toBe(200);
    expect(re.json().affected).toEqual([
      expect.objectContaining({ forge_id: id, key: 'fan', from_mm: 60, to_mm: 58, needs_rebuild: expect.arrayContaining(['plate', 'opening', 'fan_holes', 'flange']) }),
    ]);
    const after = (await call('GET', `/v1/forges/${id}`)).json();
    expect(after.source.dimensions.fan).toMatchObject({ source: 'measured', value_mm: 58, stale: true });
    // Rebuilding at the new value keeps it measured.
    const save = await call('POST', `/v1/forges/${id}/versions`, { params: { ...after.version.params, fan: 58 } }, { 'idempotency-key': key() });
    await run(save.json().job.id);
    const v4 = (await call('GET', `/v1/forges/${id}`)).json();
    expect(v4.version.params.fan).toBe(58);
    expect(v4.source.dimensions.fan).toEqual({ source: 'measured', calibration_id: cal.json().id, value_mm: 58 });
  });

  it('printer profiles: generic default first, named rows cite their source; a forge can switch', async () => {
    const list = (await t.app.inject({ method: 'GET', url: '/v1/printer-profiles' })).json().data as { id: string; key: string; is_generic: boolean; source_url: string | null; bed_mm: number[] }[];
    expect(list[0]!.is_generic).toBe(true);
    for (const p of list.filter((x) => !x.is_generic)) expect(p.source_url).toMatch(/^https:/);
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie);
    expect((await call('GET', `/v1/forges/${id}`)).json().printer.key).toBe('generic-fdm');
    const mini = list.find((p) => p.key === 'prusa-mini-plus')!;
    const r = await call('PUT', `/v1/forges/${id}/printer-profile`, { profile_id: mini.id });
    expect(r.json().printer.bed_mm).toEqual([180, 180, 180]);
    expect((await call('PUT', `/v1/forges/${id}/printer-profile`, { profile_id: mini.id, bed_mm: [300, 300, 300] })).statusCode).toBe(400);
    const g = await call('PUT', `/v1/forges/${id}/printer-profile`, { profile_id: list[0]!.id, bed_mm: [300, 250, 200] });
    expect(g.json().printer.bed_mm).toEqual([300, 250, 200]);
  });
});

describe('test sections and export records (M6-E)', () => {
  async function upgrade(email: string, code: string) {
    const u = await w.db.user.findUniqueOrThrow({ where: { email } });
    const plan = await w.db.plan.findUniqueOrThrow({ where: { code } });
    await w.db.subscription.updateMany({ where: { ownerId: u.id }, data: { planId: plan.id } });
  }

  it('a snap-fit ridge test section matches the feature bounds within 0.05 mm, is labeled, and links to its version', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const id = await newForge(s.cookie, 'box-with-lid');
    const ridge = (await call('GET', `/v1/forges/${id}/features`)).json().data.find((f: { key: string }) => f.key === 'ridge');
    const r = await call('POST', `/v1/forges/${id}/test-sections`, { feature_key: 'ridge' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(202);
    await run(r.json().job.id);
    const job = (await call('GET', `/v1/jobs/${r.json().job.id}`)).json();
    expect(job.status).toBe('SUCCEEDED');
    expect(job.output).toMatchObject({ is_test_section: true, feature_key: 'ridge' });
    const forge = (await call('GET', `/v1/forges/${id}`)).json();
    expect(job.output.parent_version_id).toBe(forge.version.id);
    const link = (await call('GET', `/v1/assets/${forge.asset_id}/files/${job.output.file_id}/url`)).json();
    const path = new URL(link.url);
    const file = await t.app.inject({ method: 'GET', url: path.pathname.replace(/^\/api/, '') + path.search });
    expect(file.headers['content-disposition']).toContain('test-section.stl');
    const buf = file.rawPayload;
    const n = buf.readUInt32LE(80);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
      const x = buf.readFloatLE(84 + i * 50 + 12 + v * 12 + a * 4);
      min[a] = Math.min(min[a]!, x);
      max[a] = Math.max(max[a]!, x);
    }
    for (let a = 0; a < 3; a++) {
      expect(Math.abs(min[a]! - ridge.bbox_mm.min[a])).toBeLessThanOrEqual(0.05);
      expect(Math.abs(max[a]! - ridge.bbox_mm.max[a])).toBeLessThanOrEqual(0.05);
    }
    const recs = (await call('GET', `/v1/forges/${id}/export-records`)).json().data;
    expect(recs[0]).toMatchObject({ is_test_section: true, format: 'stl', version_id: forge.version.id, file_id: job.output.file_id });
    expect(recs[0].license_snapshot.is_test_section).toBe(true);
  });

  it('a free-plan export has no commercial-use terms in its snapshot; a paid-plan export does', async () => {
    const free = await signIn(t);
    const idFree = await newForge(free.cookie, 'planter');
    await as(t, free.cookie)('POST', `/v1/forges/${idFree}/exports`, { format: 'stl' }, { 'idempotency-key': key() });
    const fr = (await as(t, free.cookie)('GET', `/v1/forges/${idFree}/export-records`)).json().data[0];
    expect(fr.plan_code_at_export).toBe('free');
    expect(fr.license_snapshot).not.toHaveProperty('commercial_use_terms');
    expect(JSON.stringify(fr.license_snapshot)).not.toMatch(/commercial/i);
    expect(fr.license_snapshot.ownership).toMatch(/You own/);
    // 3MF and STEP are not on the free plan.
    expect((await as(t, free.cookie)('POST', `/v1/forges/${idFree}/exports`, { format: '3mf' }, { 'idempotency-key': key() })).statusCode).toBe(402);

    const paid = await signIn(t);
    await upgrade(paid.email, 'creator');
    const idPaid = await newForge(paid.cookie, 'planter');
    expect((await as(t, paid.cookie)('POST', `/v1/forges/${idPaid}/exports`, { format: '3mf' }, { 'idempotency-key': key() })).statusCode).toBe(202);
    expect((await as(t, paid.cookie)('POST', `/v1/forges/${idPaid}/exports`, { format: 'step' }, { 'idempotency-key': key() })).statusCode).toBe(402);
    const browser = await as(t, paid.cookie)('POST', `/v1/forges/${idPaid}/export-records`, { format: 'stl' });
    expect(browser.statusCode).toBe(201);
    expect(browser.json()).toMatchObject({ source: 'browser', plan_code_at_export: 'creator' });
    const pr = (await as(t, paid.cookie)('GET', `/v1/forges/${idPaid}/export-records`)).json().data;
    expect(pr).toHaveLength(2);
    for (const r of pr) expect(r.license_snapshot.commercial_use_terms).toMatch(/commercial use/);
  });

  it('a plane slab section is refused when it misses the part', async () => {
    const s = await signIn(t);
    const id = await newForge(s.cookie);
    const r = await as(t, s.cookie)('POST', `/v1/forges/${id}/test-sections`, { plane: { axis: 'z', from_mm: 500, to_mm: 510 } }, { 'idempotency-key': key() });
    await run(r.json().job.id);
    expect((await as(t, s.cookie)('GET', `/v1/jobs/${r.json().job.id}`)).json().error.code).toBe('SECTION_EMPTY');
  });
});

describe('content policy on three paths (M6-F)', () => {
  const photo = readFileSync(new URL('./fixtures/fan-photo.jpg', import.meta.url));
  async function upload(cookie: string, body: Buffer) {
    const res = await t.app.inject({ method: 'POST', url: '/v1/uploads', headers: { origin: ORIGIN, cookie }, payload: { filename: 'p.jpg', content_type: 'image/jpeg', bytes: body.length, purpose: 'image' } });
    const created = res.json();
    const u = new URL(created.put.url);
    await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': 'image/jpeg' }, payload: body });
    return { id: created.upload.id as string, done: await t.app.inject({ method: 'POST', url: `/v1/uploads/${created.upload.id}/complete`, headers: { origin: ORIGIN, cookie } }) };
  }

  it('a prohibited prompt, a prohibited image, and a prohibited edit each return PROHIBITED_ITEM and are logged with a hashed user', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const uid = fromApiId('user', s.userId)!;
    const before = await w.db.contentRefusal.count();

    // 1. Text: describing a prohibited item.
    const p = await call('POST', '/v1/forges', { prompt: 'a lower receiver for an AR-15' }, { 'idempotency-key': key() });
    expect(p.statusCode).toBe(422);
    expect(p.json().error.code).toBe('PROHIBITED_ITEM');
    expect(p.json().error.message).not.toMatch(/instead|try/i);

    // 2. Image: the classifier flags it; it is held for review, not dropped or used.
    const img = await upload(s.cookie, Buffer.concat([photo, Buffer.from('SW-TEST-PROHIBITED')]));
    expect(img.done.statusCode).toBe(422);
    expect(img.done.json().error.code).toBe('PROHIBITED_ITEM');
    const row = await w.db.upload.findUnique({ where: { id: fromApiId('upload', img.id)! } });
    expect(row!.status).toBe('FLAGGED');
    expect(row!.storageKey.startsWith('quarantine/')).toBe(true);
    const held = await w.db.moderationCase.findFirst({ where: { subjectId: row!.id } });
    expect(held).toMatchObject({ kind: 'IMAGE', status: 'OPEN' });
    expect((await call('POST', '/v1/calibrations', { photo_upload_id: img.id, line_px: [[0, 0], [100, 0]], real_length_mm: 10 })).statusCode).toBe(409);

    // 3. Edit: the proposal names a prohibited item and is refused before anyone sees it.
    const id = await newForge(s.cookie);
    const e = await call('POST', `/v1/forges/${id}/copilot-edits`, { message: 'tidy the rim [[prohibited-result]]' }, { 'idempotency-key': key() });
    await run(e.json().job.id);
    const edit = (await call('GET', `/v1/copilot-edits/${e.json().edit.id}`)).json();
    expect(edit.status).toBe('FAILED');
    expect(edit.diff).toBeNull();
    expect((await call('GET', `/v1/jobs/${e.json().job.id}`)).json().error.code).toBe('PROHIBITED_ITEM');

    const logs = await w.db.contentRefusal.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
    expect(await w.db.contentRefusal.count()).toBe(before + 3);
    expect(logs.map((l) => l.path).sort()).toEqual(['edit', 'image', 'text']);
    for (const l of logs) {
      expect(l.userHash).toMatch(/^[0-9a-f]{32}$/);
      expect(l.userHash).not.toContain(uid.replace(/-/g, ''));
    }
    expect(new Set(logs.map((l) => l.userHash)).size).toBe(1);
  });

  it('admins review held images and see the weekly refusal summary', async () => {
    const s = await signIn(t);
    await upload(s.cookie, Buffer.concat([photo, Buffer.from('SW-TEST-PROHIBITED')]));
    const admin = await signInAdmin(t);
    const call = as(t, admin.cookie);
    const cases = (await call('GET', '/admin/moderation-cases')).json().data;
    expect(cases.length).toBeGreaterThan(0);
    const d = await call('POST', `/admin/moderation-cases/${cases[0].id}/decide`, { decision: 'UPHELD', reason: 'shows a firearm part' });
    expect(d.json().status).toBe('UPHELD');
    const sum = (await call('GET', '/admin/refusals?days=7')).json();
    expect(sum.total).toBeGreaterThan(0);
    expect(sum.by.some((r: { path: string }) => r.path === 'image')).toBe(true);
    expect((await as(t, s.cookie)('GET', '/admin/refusals')).statusCode).toBe(403);
  });
});
