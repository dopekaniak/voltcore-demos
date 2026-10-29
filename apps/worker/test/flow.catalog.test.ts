import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn, signInAdmin } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { MeshClient } from '@sw/shared/node';
import { fsStorage } from '@sw/storage';
import { dispatchForge } from '../src/dispatch';
import { makeWorkerCtx } from './helpers';
import { startMeshService } from './mesh-service';

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

async function modelAsset(cookie: string) {
  const job = (await as(t, cookie)('POST', '/v1/forges', { starter_key: 'cable-clip' }, { 'idempotency-key': key() })).json().job;
  await dispatchForge(w, fromApiId('job', job.id)!);
  return (await as(t, cookie)('GET', `/v1/jobs/${job.id}`)).json().output.asset_id as string;
}

async function catalogPart(cookie: string, license: string | null, body: Record<string, unknown> = {}) {
  const call = as(t, cookie);
  const assetId = await modelAsset(cookie);
  if (license) expect((await call('PUT', `/v1/assets/${assetId}/license`, { code: license })).statusCode).toBe(200);
  const r = await call('POST', '/v1/parts', { asset_id: assetId, title: 'Dash cable clip', category: 'interior-trim', safety_class: 'COSMETIC', print_order_allowed: true, ...body });
  expect(r.statusCode).toBe(201);
  return r.json();
}

describe('licenses', () => {
  it('lists the supported licenses', async () => {
    const list = (await t.app.inject({ method: 'GET', url: '/v1/licenses' })).json().data.map((l: { code: string }) => l.code);
    expect(list).toEqual(expect.arrayContaining(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'ALL-RIGHTS-RESERVED']));
  });
  it('sets a license with attribution and supports custom license text', async () => {
    const s = await signIn(t);
    const assetId = await modelAsset(s.cookie);
    const l = (await as(t, s.cookie)('PUT', `/v1/assets/${assetId}/license`, { code: 'CC-BY-4.0' })).json();
    expect(l).toMatchObject({ code: 'CC-BY-4.0', allows_print_order: true });
    expect(l.attribution).toContain('licensed CC BY 4.0');
    const c = (await as(t, s.cookie)('PUT', `/v1/assets/${assetId}/license`, { code: 'CUSTOM', custom_text: 'You may print one copy for yourself only.' })).json();
    expect(c).toMatchObject({ name: 'Custom license', allows_print_order: false });
  });
});

describe('safety classes (enforced on the server)', () => {
  it('a printable part can be quoted and added to the cart after the fit disclaimer', async () => {
    const s = await signIn(t);
    const p = await catalogPart(s.cookie, 'CC-BY-4.0');
    expect(p.print).toMatchObject({ orderable: true });
    const call = as(t, s.cookie);
    const noAck = await call('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: false }, { 'idempotency-key': key() });
    expect(noAck.json().error.code).toBe('FIT_DISCLAIMER_REQUIRED');
    const q = await call('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: true }, { 'idempotency-key': key() });
    expect(q.statusCode).toBe(201);
    expect((await call('POST', '/v1/cart/items', { quote_id: q.json().quote.id })).statusCode).toBe(201);
  });

  it('a SAFETY_CRITICAL part cannot be quoted, and a forged cart item is refused with 403 PART_NOT_PRINTABLE', async () => {
    const s = await signIn(t);
    const admin = await signInAdmin(t);
    const p = await catalogPart(s.cookie, 'CC-BY-4.0');
    const call = as(t, s.cookie);
    const q = (await call('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: true }, { 'idempotency-key': key() })).json();
    const reclass = await as(t, admin.cookie)('POST', `/admin/parts/${p.id}/safety-class`, { safety_class: 'SAFETY_CRITICAL', reason: 'Mounts to the steering column shroud' });
    expect(reclass.json()).toMatchObject({ safety_class: 'SAFETY_CRITICAL', print: { orderable: false } });
    expect(reclass.json().safety_warning).toContain('not available for printing');
    const audit = await t.ctx.db.auditLog.findFirst({ where: { action: 'part.safety_class', targetId: fromApiId('catalogPart', p.id)! } });
    expect(audit?.reason).toBe('Mounts to the steering column shroud');

    const again = await call('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: true }, { 'idempotency-key': key() });
    expect(again.statusCode).toBe(403);
    expect(again.json().error.code).toBe('PART_NOT_PRINTABLE');
    // The quote made before reclassification cannot reach the cart either.
    const add = await call('POST', '/v1/cart/items', { quote_id: q.quote.id });
    expect(add.statusCode).toBe(403);
    expect(add.json().error.code).toBe('PART_NOT_PRINTABLE');
    // A forged print part pointing at the critical part (as if a client crafted the IDs).
    const pp = await t.ctx.db.printPart.findFirstOrThrow({ where: { catalogPartId: fromApiId('catalogPart', p.id)! } });
    const forged = await t.ctx.db.printPart.create({ data: { ownerId: pp.ownerId, title: 'forged', catalogPartId: pp.catalogPartId, fitAcknowledgedAt: new Date(), status: 'READY', analysis: pp.analysis as object, settings: pp.settings as object } });
    const fq = await call('PATCH', `/v1/print/parts/prt_${forged.id.replace(/-/g, '')}`, { settings: {} });
    const forgedAdd = await call('POST', '/v1/cart/items', { quote_id: fq.json().quote.id });
    expect(forgedAdd.statusCode).toBe(403);
    expect(forgedAdd.json().error.code).toBe('PART_NOT_PRINTABLE');
    // The same model cannot be printed through the library route.
    const assetId = p.asset_id as string;
    const v = (await call('GET', `/v1/assets/${assetId}`)).json().versions[0].id;
    expect((await call('POST', '/v1/print/parts', { asset_version_id: v }, { 'idempotency-key': key() })).json().error.code).toBe('PART_NOT_PRINTABLE');
  });

  it('parts naming safety systems are classed SAFETY_CRITICAL automatically', async () => {
    const s = await signIn(t);
    const p = await catalogPart(s.cookie, 'CC-BY-4.0', { title: 'Brake caliper bracket', category: 'brakes', safety_class: 'COSMETIC' });
    expect(p.safety_class).toBe('SAFETY_CRITICAL');
    expect(p.print.orderable).toBe(false);
  });

  it('a CC-BY-NC part shows print disabled with "non-commercial license" and the API refuses it', async () => {
    const s = await signIn(t);
    const p = await catalogPart(s.cookie, 'CC-BY-NC-4.0');
    expect(p.print).toMatchObject({ orderable: false, reason: 'non-commercial license' });
    const r = await as(t, s.cookie)('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: true }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('LICENSE_FORBIDS_PRINT');
  });

  it('a part with no license cannot be printed', async () => {
    const s = await signIn(t);
    const p = await catalogPart(s.cookie, null);
    expect(p.license).toBeNull();
    expect((await as(t, s.cookie)('POST', `/v1/parts/${p.id}/print-quotes`, { acknowledge_fit: true }, { 'idempotency-key': key() })).json().error.code).toBe('LICENSE_MISSING');
  });

  it('only admins with TOTP can change safety classes', async () => {
    const s = await signIn(t);
    const p = await catalogPart(s.cookie, 'CC-BY-4.0');
    const r = await as(t, s.cookie)('POST', `/admin/parts/${p.id}/safety-class`, { safety_class: 'NONE', reason: 'trying to unblock' });
    expect(r.statusCode).toBe(403);
  });
});
