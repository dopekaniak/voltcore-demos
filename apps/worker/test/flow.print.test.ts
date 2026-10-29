import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, ORIGIN, signIn } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { MeshClient } from '@sw/shared/node';
import { fsStorage } from '@sw/storage';
import { dispatchForge, dispatchMesh } from '../src/dispatch';
import { makeWorkerCtx } from './helpers';
import { startMeshService } from './mesh-service';
import { boxStl } from './stl';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const w = makeWorkerCtx();
let mesh: { url: string; stop: () => void };
beforeAll(async () => {
  mesh = await startMeshService();
  t = await makeTestApp({ STORAGE_DIR: w.env.STORAGE_DIR, MESH_URL: mesh.url });
  t.ctx.mesh = new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN });
  Object.assign(w, { storage: fsStorage({ dir: w.env.STORAGE_DIR, secret: w.env.APP_SECRET, publicBase: w.env.PUBLIC_FILES_BASE }), mesh: new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN }) });
}, 60_000);
afterAll(async () => {
  await t.close();
  await w.close();
  mesh.stop();
});
const key = () => `k-${crypto.randomUUID()}`;
type Call = ReturnType<typeof as>;

/** Anonymous client keeping its sw_anon cookie. */
function anonClient() {
  let cookie = '';
  const call: Call = async (method, url, payload, headers = {}) => {
    const r = await t.app.inject({ method, url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    const set = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('sw_anon='));
    if (set) cookie = set.split(';')[0]!;
    return r;
  };
  return { call, cookie: () => cookie };
}

async function uploadPart(call: Call, body: Buffer, name = 'part.stl') {
  const c = await call('POST', '/v1/uploads', { filename: name, content_type: 'model/stl', bytes: body.length, purpose: 'print' });
  const u = new URL(c.json().put.url);
  await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': 'model/stl' }, payload: body });
  expect((await call('POST', `/v1/uploads/${c.json().upload.id}/complete`)).json().upload.status).toBe('CLEAN');
  const p = await call('POST', '/v1/print/parts', { upload_id: c.json().upload.id }, { 'idempotency-key': key() });
  expect(p.statusCode).toBe(201);
  return p.json().part;
}

describe('upload and quote (anonymous)', () => {
  it('J3 backend: upload anonymously → repair → quote → change material → sign in → cart', async () => {
    const anon = anonClient();
    const part = await uploadPart(anon.call, boxStl(120, 90, 60, true));
    expect(part.status).toBe('NEEDS_REPAIR');
    expect(part.analysis.watertight).toBe(false);
    expect(part.expires_at).not.toBeNull();

    const rep = await anon.call('POST', `/v1/print/parts/${part.id}/repair`, undefined, { 'idempotency-key': key() });
    expect(rep.statusCode).toBe(202);
    await dispatchMesh(w, fromApiId('job', rep.json().job.id)!);
    const repaired = (await anon.call('GET', `/v1/print/parts/${part.id}`)).json().part;
    expect(repaired.status).toBe('READY');
    expect(repaired.repair.before.watertight).toBe(false);
    expect(repaired.repair.after.watertight).toBe(true);
    expect(repaired.use_repaired).toBe(true);

    const pla = (await anon.call('PATCH', `/v1/print/parts/${part.id}`, { settings: { material: 'PLA' } })).json().quote;
    expect(pla).toMatchObject({ is_estimate: true, orderable: false, currency: 'USD', tax_note: 'Tax calculated where applicable.', status: 'ACTIVE' });
    expect(new Date(pla.expires_at).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    const asa = (await anon.call('PATCH', `/v1/print/parts/${part.id}`, { settings: { material: 'ASA', color: 'white' } })).json().quote;
    expect(asa.total_minor).not.toBe(pla.total_minor);
    expect(asa.lines[0].material).toBe('ASA');

    // Cart needs an account; signing in claims the anonymous part and quote.
    expect((await anon.call('POST', '/v1/cart/items', { quote_id: asa.id })).statusCode).toBe(401);
    const s = await signIn(t, undefined, anon.cookie());
    const user = as(t, s.cookie);
    expect((await user('GET', `/v1/print/parts/${part.id}`)).json().part.expires_at).toBeNull();
    const cart = await user('POST', '/v1/cart/items', { quote_id: asa.id });
    expect(cart.statusCode).toBe(201);
    expect(cart.json()).toMatchObject({ subtotal_minor: asa.subtotal_minor, orderable: false });
    expect(cart.json().items).toHaveLength(1);
  });

  it('J5: client-sent amounts are ignored and a changed price returns 409 QUOTE_CHANGED', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const part = await uploadPart(call, boxStl(20, 20, 20));
    const q = await call('POST', '/v1/print/quotes', { part_id: part.id, settings: { quantity: 3 }, total_minor: 1, unit_price_minor: 1 }, { 'idempotency-key': key() });
    expect(q.statusCode).toBe(201);
    expect(q.json().total_minor).toBeGreaterThan(1000);
    // Simulate a stale price (for example, after a material cost change) in the stored quote.
    await t.ctx.db.quote.update({ where: { id: fromApiId('quote', q.json().id)! }, data: { totalMinor: Math.round(q.json().total_minor * 0.9) } });
    const add = await call('POST', '/v1/cart/items', { quote_id: q.json().id, total_minor: 1 });
    expect(add.statusCode).toBe(409);
    expect(add.json().error.code).toBe('QUOTE_CHANGED');
    const fresh = add.json().error.details.quote;
    expect(fresh.total_minor).toBe(q.json().total_minor);
    expect((await call('POST', '/v1/cart/items', { quote_id: fresh.id })).statusCode).toBe(201);
    // The superseded quote can no longer be used.
    expect((await call('POST', '/v1/cart/items', { quote_id: q.json().id })).json().error.code).toBe('QUOTE_EXPIRED');
  });

  it('expired quotes are refused; oversize and out-of-range settings are explained', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const part = await uploadPart(call, boxStl(300, 20, 20));
    const big = await call('POST', '/v1/print/quotes', { part_id: part.id }, { 'idempotency-key': key() });
    expect(big.json().error).toMatchObject({ code: 'PART_TOO_LARGE', details: { suggested_scale_pct: 85 } });
    const ok = await call('POST', '/v1/print/quotes', { part_id: part.id, settings: { scale_pct: 80 } }, { 'idempotency-key': key() });
    expect(ok.statusCode).toBe(201);
    expect((await call('PATCH', `/v1/print/parts/${part.id}`, { settings: { quantity: 501 } })).json().error.code).toBe('QUANTITY_OUT_OF_RANGE');
    expect((await call('PATCH', `/v1/print/parts/${part.id}`, { settings: { scale_pct: 2000 } })).json().error.code).toBe('SCALE_OUT_OF_RANGE');
    expect((await call('PATCH', `/v1/print/parts/${part.id}`, { settings: { layer_height_um: 150 } })).json().error.code).toBe('VALIDATION_FAILED');
    await t.ctx.db.quote.update({ where: { id: fromApiId('quote', ok.json().id)! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call('POST', '/v1/cart/items', { quote_id: ok.json().id })).json().error.code).toBe('QUOTE_EXPIRED');
  });

  it('rejects zip-bomb 3MF uploads at completion', async () => {
    const { zipSync } = await import('fflate');
    const bomb = Buffer.from(zipSync({ '3D/3dmodel.model': new Uint8Array(8 * 1024 * 1024) }));
    const s = await signIn(t);
    const c = await as(t, s.cookie)('POST', '/v1/uploads', { filename: 'bomb.3mf', content_type: 'model/3mf', bytes: bomb.length, purpose: 'print' });
    const u = new URL(c.json().put.url);
    await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': 'model/3mf' }, payload: bomb });
    const done = await as(t, s.cookie)('POST', `/v1/uploads/${c.json().upload.id}/complete`);
    expect(done.json().error.code).toBe('UPLOAD_REJECTED');
  });
});

describe('send a forge to print', () => {
  it('blocks a forge with failing checks from the cart until acknowledged', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const job = (await call('POST', '/v1/forges', { starter_key: 'planter' }, { 'idempotency-key': key() })).json().job;
    await dispatchForge(w, fromApiId('job', job.id)!);
    const forgeId = (await call('GET', `/v1/jobs/${job.id}`)).json().output.forge_id;
    const created = await call('POST', '/v1/print/parts', { forge_id: forgeId, params: { wall: 0.8, diameter: 80 } }, { 'idempotency-key': key() });
    expect(created.json().part.status).toBe('ANALYZING');
    await dispatchForge(w, fromApiId('job', created.json().part.job_id)!);
    const part = (await call('GET', `/v1/print/parts/${created.json().part.id}`)).json().part;
    expect(part).toMatchObject({ status: 'READY', checks_failing: true, checks_acknowledged: false, source: 'forge' });
    const q = (await call('PATCH', `/v1/print/parts/${part.id}`, { settings: {} })).json().quote;
    expect((await call('POST', '/v1/cart/items', { quote_id: q.id })).json().error.code).toBe('CHECKS_NOT_ACKNOWLEDGED');
    const q2 = (await call('PATCH', `/v1/print/parts/${part.id}`, { acknowledge_checks: true })).json().quote;
    expect((await call('POST', '/v1/cart/items', { quote_id: q2.id })).statusCode).toBe(201);
  });
});

describe('IDOR: parts, quotes, carts', () => {
  it('another user or visitor cannot read or change them', async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const part = await uploadPart(as(t, a.cookie), boxStl(10, 10, 10));
    const q = (await as(t, a.cookie)('POST', '/v1/print/quotes', { part_id: part.id }, { 'idempotency-key': key() })).json();
    const cart = (await as(t, a.cookie)('POST', '/v1/cart/items', { quote_id: q.id })).json();
    const callB = as(t, b.cookie);
    expect((await callB('GET', `/v1/print/parts/${part.id}`)).statusCode).toBe(404);
    expect((await callB('PATCH', `/v1/print/parts/${part.id}`, { settings: {} })).statusCode).toBe(404);
    expect((await callB('POST', `/v1/print/parts/${part.id}/repair`, undefined, { 'idempotency-key': key() })).statusCode).toBe(404);
    expect((await callB('GET', `/v1/print/quotes/${q.id}`)).statusCode).toBe(404);
    expect((await callB('POST', `/v1/print/quotes/${q.id}/claim`)).statusCode).toBe(404);
    expect((await callB('POST', '/v1/cart/items', { quote_id: q.id })).statusCode).toBe(404);
    expect((await callB('DELETE', `/v1/cart/items/${cart.items[0].id}`)).statusCode).toBe(404);
    expect((await callB('GET', '/v1/cart')).json().items).toEqual([]);
    const anon = anonClient();
    expect((await anon.call('GET', `/v1/print/parts/${part.id}`)).statusCode).toBe(404);
    expect((await as(t, a.cookie)('GET', '/v1/cart')).json().items).toHaveLength(1);
  });
});
