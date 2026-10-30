import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, ORIGIN, signIn } from '@sw/api/testing';
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
  Object.assign(w, { env: { ...w.env, MESH_URL: mesh.url }, storage: fsStorage({ dir: w.env.STORAGE_DIR, secret: w.env.APP_SECRET, publicBase: w.env.PUBLIC_FILES_BASE }), mesh: new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN }) });
}, 60_000);
afterAll(async () => {
  await t.close();
  await w.close();
  mesh.stop();
});
const key = () => `k-${crypto.randomUUID()}`;

async function download(call: ReturnType<typeof as>, jobId: string) {
  const link = (await call('GET', `/v1/jobs/${jobId}/file`)).json();
  const u = new URL(link.url);
  return (await t.app.inject({ method: 'GET', url: u.pathname.replace(/^\/api/, '') + u.search })).rawPayload;
}

function stlBounds(b: Buffer) {
  const n = b.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const c = b.readFloatLE(84 + i * 50 + 12 + v * 12 + k * 4);
    min[k] = Math.min(min[k]!, c);
    max[k] = Math.max(max[k]!, c);
  }
  return max.map((m, i) => +(m - min[i]!).toFixed(2));
}

describe('customizers', () => {
  it('lists the four starters', async () => {
    const r = (await t.app.inject({ method: 'GET', url: '/v1/customizers' })).json().data.map((c: { key: string }) => c.key);
    expect(r).toEqual(['nameplate', 'storage-tile', 'relief-coaster', 'cable-organizer']);
  });

  it('a free user exports a name plate STL with custom text; the bounding box matches; the footer shows', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const c = (await call('GET', '/v1/customizers/nameplate')).json();
    expect(c.export).toMatchObject({ free_remaining: 3, formats: ['stl'], footer: 'Made with the Shapewright Name plate or keychain customizer' });
    const r = await call('POST', `/v1/customizers/${c.id}/exports`, { inputs: { label: 'MORGAN', width: 70, height: 24, thickness: 3, depth: 1.5 }, format: 'stl' }, { 'idempotency-key': key() });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ free: true, credits: 0, footer: c.export.footer });
    await dispatchForge(w, fromApiId('job', r.json().job.id)!);
    const bb = stlBounds(await download(call, r.json().job.id));
    expect(bb[0]).toBeCloseTo(70, 1);
    expect(bb[1]).toBeCloseTo(24, 1);
    expect(bb[2]).toBeCloseTo(4.5, 1); // plate + raised letters
    expect((await call('GET', '/v1/billing/wallet')).json().balance).toBe(100);
  });

  it('rejects disallowed characters and clamps sizes with a visible message', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const bad = await call('POST', '/v1/customizers/nameplate/previews', { inputs: { label: 'HELLO<>' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('CUSTOMIZER_INPUT_INVALID');
    const ok = (await call('POST', '/v1/customizers/nameplate/previews', { inputs: { label: 'OK', width: 1000 } })).json();
    expect(ok.values.width).toBe(120);
    expect(ok.clamped[0].message).toBe('Width was lowered to the maximum, 120 mm.');
  });

  it('free plans get STL only and three free exports a month, then exports cost credits', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    expect((await call('POST', '/v1/customizers/storage-tile/exports', { inputs: {}, format: '3mf' }, { 'idempotency-key': key() })).statusCode).toBe(402);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await call('POST', '/v1/customizers/storage-tile/exports', { inputs: { cols: i + 1 }, format: 'stl' }, { 'idempotency-key': key() })).json());
    expect(results.map((r) => r.free)).toEqual([true, true, true, false]);
    expect(results[3].credits).toBe(5);
    expect((await call('GET', '/v1/billing/wallet')).json()).toMatchObject({ reserved: 5 });
  });

  it('builds a relief coaster from an uploaded image', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const { PNG } = await import('pngjs');
    const img = new PNG({ width: 32, height: 32 });
    for (let i = 0; i < 32 * 32; i++) img.data.set([i % 32 * 8, i % 32 * 8, i % 32 * 8, 255], i * 4);
    const png = PNG.sync.write(img);
    const c = await call('POST', '/v1/uploads', { filename: 'logo.png', content_type: 'image/png', bytes: png.length, purpose: 'image' });
    const u = new URL(c.json().put.url);
    await t.app.inject({ method: 'PUT', url: u.pathname.replace(/^\/api/, '') + u.search, headers: { 'content-type': 'image/png' }, payload: png });
    await t.app.inject({ method: 'POST', url: `/v1/uploads/${c.json().upload.id}/complete`, headers: { origin: ORIGIN, cookie: s.cookie } });
    const grid = (await call('POST', '/v1/customizers/relief-coaster/relief', { upload_id: c.json().upload.id })).json();
    expect(grid).toMatchObject({ width: 48, height: 48 });
    expect(grid.data).toHaveLength(48 * 48);
    const r = await call('POST', '/v1/customizers/relief-coaster/exports', { inputs: {}, format: 'stl', image_upload_id: c.json().upload.id }, { 'idempotency-key': key() });
    await dispatchForge(w, fromApiId('job', r.json().job.id)!);
    expect((await call('GET', `/v1/jobs/${r.json().job.id}`)).json().status).toBe('SUCCEEDED');
    expect(stlBounds(await download(call, r.json().job.id))[0]).toBeCloseTo(95, 0);
  });

  it('refuses prohibited text', async () => {
    const s = await signIn(t);
    expect((await as(t, s.cookie)('POST', '/v1/customizers/nameplate/previews', { inputs: { label: 'GLOCK' } })).json().error.code).toBe('PROHIBITED_ITEM');
  });
});
