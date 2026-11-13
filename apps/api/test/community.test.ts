import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fromApiId, newId, toApiId } from '@sw/shared';
import { as, makeTestApp, signIn, signInAdmin } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let auto: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp({ COMMUNITY_REVIEW: 'required' });
  auto = await makeTestApp({ COMMUNITY_REVIEW: 'auto' });
});
afterAll(async () => {
  await t.close();
  await auto.close();
});

type App = typeof t;
const uid = (s: { userId: string }) => fromApiId('user', s.userId)!;

/** A creator with a handle and one library model (a cube STL), straight in the database. */
async function creator(app: App, opts: { watertight?: boolean; handle?: string } = {}) {
  const s = await signIn(app);
  const call = as(app, s.cookie);
  const handle = opts.handle ?? `maker${Math.random().toString(36).slice(2, 10)}`;
  expect((await call('PUT', '/v1/me/profile', { handle })).statusCode).toBe(200);
  return { ...s, call, handle, model: (title?: string) => model(app, uid(s), title, opts.watertight ?? true) };
}

async function model(app: App, ownerId: string, title = 'Cable organizer clip', watertight = true) {
  const assetId = newId();
  const versionId = newId();
  const key = `assets/${assetId}/${versionId}/model.stl`;
  await app.ctx.storage.put(key, Buffer.from('solid x\nendsolid x\n'), 'model/stl');
  await app.ctx.db.asset.create({ data: { id: assetId, ownerId, kind: 'UPLOAD', title } });
  await app.ctx.db.assetVersion.create({ data: { id: versionId, assetId, number: 1, stage: 'UPLOAD', triangles: 12, bboxMm: [20, 20, 20], isWatertight: watertight } });
  await app.ctx.db.assetFile.create({ data: { ownerId, assetVersionId: versionId, role: 'STL', storageKey: key, contentType: 'model/stl', filename: 'model.stl', bytes: 20 } });
  await app.ctx.db.asset.update({ where: { id: assetId }, data: { currentVersionId: versionId } });
  return toApiId('asset', assetId);
}

const page = { description: 'A clip that keeps desk cables tidy. Prints flat.', category: 'organizers', tags: ['cable', 'desk'] };

describe('Community: sharing rules', () => {
  it('needs a creator name and a license before a model can be shared', async () => {
    const s = await signIn(auto);
    const call = as(auto, s.cookie);
    const id = await model(auto, uid(s));
    const noHandle = await call('POST', `/v1/community/models/${id}/publish`, page);
    expect(noHandle.json().error.code).toBe('CREATOR_HANDLE_REQUIRED');
    await call('PUT', '/v1/me/profile', { handle: `h${Date.now()}` });
    const noLicense = await call('POST', `/v1/community/models/${id}/publish`, page);
    expect(noLicense.statusCode).toBe(422);
    expect(noLicense.json().error.code).toBe('LICENSE_MISSING');
    await call('PUT', `/v1/assets/${id}/license`, { code: 'CC-BY-4.0' });
    const ok = await call('POST', `/v1/community/models/${id}/publish`, page);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ publish_status: 'PUBLISHED', license: { code: 'CC-BY-4.0' }, category: 'organizers', tags: ['cable', 'desk'] });
  });

  it('creator names are unique (any case), cannot be reserved words, and are set once', async () => {
    const a = await creator(auto, { handle: `Unique${Date.now()}` });
    const b = await signIn(auto);
    const callB = as(auto, b.cookie);
    expect((await callB('PUT', '/v1/me/profile', { handle: a.handle.toLowerCase() })).json().error.code).toBe('HANDLE_TAKEN');
    expect((await callB('PUT', '/v1/me/profile', { handle: 'admin' })).json().error.code).toBe('HANDLE_TAKEN');
    expect((await a.call('PUT', '/v1/me/profile', { handle: `other${Date.now()}` })).json().error.code).toBe('INVALID_STATE');
  });

  it('with review on, a submitted model is hidden from others until a reviewer approves it', async () => {
    const c = await creator(t);
    const title = `Hex key holder ${Date.now().toString(36)}`;
    const id = await c.model(title);
    await c.call('PUT', `/v1/assets/${id}/license`, { code: 'CC0-1.0' });
    const r = await c.call('POST', `/v1/community/models/${id}/publish`, page);
    expect(r.json().publish_status).toBe('REVIEW');
    const other = await signIn(t);
    expect((await as(t, other.cookie)('GET', `/v1/community/models/${id}`)).statusCode).toBe(404);
    expect((await as(t, other.cookie)('GET', `/v1/assets/${id}`)).statusCode).toBe(404);
    const search = () => t.app.inject({ method: 'GET', url: `/v1/community/models?q=${encodeURIComponent(title)}` }).then((r) => r.json().data);
    expect(await search()).toHaveLength(0);

    const admin = await signInAdmin(t);
    const queue = (await as(t, admin.cookie)('GET', '/admin/community/review')).json().data;
    expect(queue.map((q: { id: string }) => q.id)).toContain(id);
    const d = await as(t, admin.cookie)('POST', `/admin/community/models/${id}/decision`, { decision: 'approve' });
    expect(d.json().publish_status).toBe('PUBLISHED');
    expect((await as(t, other.cookie)('GET', `/v1/community/models/${id}`)).statusCode).toBe(200);
    expect((await search())[0].id).toBe(id);
  });

  it('a rejected model shows the reviewer note to its owner only', async () => {
    const c = await creator(t);
    const id = await c.model();
    await c.call('PUT', `/v1/assets/${id}/license`, { code: 'CC-BY-4.0' });
    await c.call('POST', `/v1/community/models/${id}/publish`, page);
    const admin = await signInAdmin(t);
    await as(t, admin.cookie)('POST', `/admin/community/models/${id}/decision`, { decision: 'reject', note: 'Add a photo of a print' });
    const mine = (await c.call('GET', `/v1/community/models/${id}`)).json();
    expect(mine).toMatchObject({ publish_status: 'REJECTED', review_note: 'Add a photo of a print' });
  });

  it('a model that is not watertight is published as needs-repair, not blocked', async () => {
    const c = await creator(auto, { watertight: false });
    const title = `Leaky vase ${Date.now().toString(36)}`;
    const id = await c.model(title);
    await c.call('PUT', `/v1/assets/${id}/license`, { code: 'CC-BY-4.0' });
    const r = (await c.call('POST', `/v1/community/models/${id}/publish`, page)).json();
    expect(r).toMatchObject({ publish_status: 'PUBLISHED', needs_repair: true, printable: false });
    const printableOnly = (await auto.app.inject({ method: 'GET', url: `/v1/community/models?q=${encodeURIComponent(title)}&printable=true` })).json();
    expect(printableOnly.data).toHaveLength(0);
  });

  it('refuses prohibited text in a page', async () => {
    const c = await creator(auto);
    const id = await c.model();
    await c.call('PUT', `/v1/assets/${id}/license`, { code: 'CC-BY-4.0' });
    const r = await c.call('POST', `/v1/community/models/${id}/publish`, { ...page, description: 'A printable gun receiver for a pistol frame' });
    expect(r.json().error.code).toBe('PROHIBITED_ITEM');
  });

  it('an unlisted model opens by link but is not in search', async () => {
    const c = await creator(auto);
    const title = `Secret shelf bracket ${Date.now().toString(36)}`;
    const id = await c.model(title);
    await c.call('PUT', `/v1/assets/${id}/license`, { code: 'CC-BY-4.0' });
    await c.call('POST', `/v1/community/models/${id}/publish`, { ...page, listed: false });
    const other = await signIn(auto);
    expect((await as(auto, other.cookie)('GET', `/v1/community/models/${id}`)).statusCode).toBe(200);
    expect((await auto.app.inject({ method: 'GET', url: `/v1/community/models?q=${encodeURIComponent(title)}` })).json().data).toHaveLength(0);
  });
});

async function published(app: App, license = 'CC-BY-4.0', title?: string) {
  const c = await creator(app);
  const id = await c.model(title);
  await c.call('PUT', `/v1/assets/${id}/license`, { code: license });
  const r = await c.call('POST', `/v1/community/models/${id}/publish`, page);
  expect(r.statusCode).toBe(200);
  return { c, id };
}

describe('Community: remixes', () => {
  it('a CC-BY-ND-4.0 model cannot be remixed', async () => {
    const { id } = await published(auto, 'CC-BY-ND-4.0');
    const u = await signIn(auto);
    const r = await as(auto, u.cookie)('POST', `/v1/community/models/${id}/remix`, undefined, { 'idempotency-key': newId() });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('LICENSE_FORBIDS_DERIVATIVE');
  });

  it('a CC-BY-4.0 model can be remixed, and the remix credits its parent', async () => {
    const { id, c: parentCreator } = await published(auto, 'CC-BY-4.0', 'Parent bracket');
    const r = await creator(auto);
    const remix = await r.call('POST', `/v1/community/models/${id}/remix`, undefined, { 'idempotency-key': newId() });
    expect(remix.statusCode).toBe(200);
    const { asset_id, required_license } = remix.json();
    expect(required_license).toBeNull();
    await r.call('PUT', `/v1/assets/${asset_id}/license`, { code: 'CC-BY-4.0' });
    const page2 = (await r.call('POST', `/v1/community/models/${asset_id}/publish`, page)).json();
    expect(page2.remix_of).toEqual({ id, title: 'Parent bracket', creator: parentCreator.handle, license_code: 'CC-BY-4.0' });
    const parent = (await auto.app.inject({ method: 'GET', url: `/v1/community/models/${id}` })).json();
    expect(parent.remixes.map((x: { id: string }) => x.id)).toContain(asset_id);
  });

  it('a remix of a share-alike model must keep the same license', async () => {
    const { id } = await published(auto, 'CC-BY-SA-4.0');
    const r = await creator(auto);
    const { asset_id, required_license } = (await r.call('POST', `/v1/community/models/${id}/remix`, undefined, { 'idempotency-key': newId() })).json();
    expect(required_license).toBe('CC-BY-SA-4.0');
    await r.call('PUT', `/v1/assets/${asset_id}/license`, { code: 'CC-BY-4.0' });
    expect((await r.call('POST', `/v1/community/models/${asset_id}/publish`, page)).json().error.code).toBe('LICENSE_INCOMPATIBLE');
    await r.call('PUT', `/v1/assets/${asset_id}/license`, { code: 'CC-BY-SA-4.0' });
    expect((await r.call('POST', `/v1/community/models/${asset_id}/publish`, page)).statusCode).toBe(200);
  });
});

describe('Community: likes, saves, downloads', () => {
  it('liking twice counts once; saves are separate and private', async () => {
    const { id } = await published(auto);
    const u = await signIn(auto);
    const call = as(auto, u.cookie);
    expect((await call('PUT', `/v1/community/models/${id}/like`)).json()).toEqual({ active: true, count: 1 });
    expect((await call('PUT', `/v1/community/models/${id}/like`)).json()).toEqual({ active: true, count: 1 });
    expect((await call('PUT', `/v1/community/models/${id}/save`)).json()).toEqual({ active: true, count: 1 });
    const d = (await call('GET', `/v1/community/models/${id}`)).json();
    expect(d).toMatchObject({ likes: 1, saves: 1, liked: true, saved: true });
    expect((await call('GET', '/v1/community/saved')).json().data.map((m: { id: string }) => m.id)).toEqual([id]);
    const other = await signIn(auto);
    expect((await as(auto, other.cookie)('GET', '/v1/community/saved')).json().data).toEqual([]);
    expect((await call('DELETE', `/v1/community/models/${id}/like`)).json()).toEqual({ active: false, count: 0 });
    expect((await call('DELETE', `/v1/community/models/${id}/like`)).json()).toEqual({ active: false, count: 0 });
  });

  it('downloads need sign-in, record the license at that moment, and count for the creator', async () => {
    const { id } = await published(auto, 'CC-BY-4.0', 'Download me');
    expect((await auto.app.inject({ method: 'POST', url: `/v1/community/models/${id}/download`, payload: {} })).statusCode).toBe(401);
    const u = await signIn(auto);
    const r = await as(auto, u.cookie)('POST', `/v1/community/models/${id}/download`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ filename: 'Download-me.stl', license: { code: 'CC-BY-4.0' } });
    const row = await auto.ctx.db.assetDownload.findFirstOrThrow({ where: { assetId: fromApiId('asset', id)! } });
    expect(row.licenseCode).toBe('CC-BY-4.0');
    expect(row.licenseSnapshot).toMatchObject({ code: 'CC-BY-4.0', allows_derivatives: true });
    expect((await auto.app.inject({ method: 'GET', url: `/v1/community/models/${id}` })).json().downloads).toBe(1);
  });
});

describe('Community: collections and comments', () => {
  it("a private collection's page is 404 to other users, even by direct id", async () => {
    const { id } = await published(auto);
    const u = await signIn(auto);
    const call = as(auto, u.cookie);
    const col = (await call('POST', '/v1/collections', { title: 'Desk upgrades' })).json();
    expect(col.is_public).toBe(false);
    expect((await call('POST', `/v1/collections/${col.id}/items`, { model_id: id })).json().items).toBe(1);
    expect((await call('POST', `/v1/collections/${col.id}/items`, { model_id: id })).json().items).toBe(1);
    const other = await signIn(auto);
    expect((await as(auto, other.cookie)('GET', `/v1/collections/${col.id}`)).statusCode).toBe(404);
    expect((await auto.app.inject({ method: 'GET', url: `/v1/collections/${col.id}` })).statusCode).toBe(404);
    await call('PATCH', `/v1/collections/${col.id}`, { is_public: true });
    expect((await as(auto, other.cookie)('GET', `/v1/collections/${col.id}`)).json().models.map((m: { id: string }) => m.id)).toEqual([id]);
  });

  it('reorders only with every item listed once', async () => {
    const a = await published(auto);
    const b = await published(auto);
    const u = await signIn(auto);
    const call = as(auto, u.cookie);
    const col = (await call('POST', '/v1/collections', { title: 'Order' })).json();
    await call('POST', `/v1/collections/${col.id}/items`, { model_id: a.id });
    await call('POST', `/v1/collections/${col.id}/items`, { model_id: b.id });
    expect((await call('PUT', `/v1/collections/${col.id}/order`, { model_ids: [b.id] })).statusCode).toBe(400);
    await call('PUT', `/v1/collections/${col.id}/order`, { model_ids: [b.id, a.id] });
    expect((await call('GET', `/v1/collections/${col.id}`)).json().models.map((m: { id: string }) => m.id)).toEqual([b.id, a.id]);
  });

  it('comments, reports, and an admin take-down', async () => {
    const { id } = await published(auto, 'CC-BY-4.0', 'Reportable thing');
    const u = await signIn(auto);
    const call = as(auto, u.cookie);
    const cm = await call('POST', `/v1/community/models/${id}/comments`, { body: 'Printed great in PETG!' });
    expect(cm.statusCode).toBe(201);
    expect((await auto.app.inject({ method: 'GET', url: `/v1/community/models/${id}/comments` })).json().data[0].body).toBe('Printed great in PETG!');
    const r1 = (await call('POST', '/v1/reports', { target_type: 'MODEL', target_id: id, reason: 'copyright' })).json();
    const r2 = (await call('POST', '/v1/reports', { target_type: 'MODEL', target_id: id, reason: 'copyright' })).json();
    expect(r1.id).toBe(r2.id);
    const admin = await signInAdmin(auto);
    const reports = (await as(auto, admin.cookie)('GET', '/admin/reports')).json().data;
    const mine = reports.find((r: { id: string }) => r.id === r1.id);
    expect(mine).toMatchObject({ target_id: id, reason: 'copyright' });
    expect((await as(auto, admin.cookie)('POST', `/admin/reports/${r1.id}/action`, { action: 'take_down' })).json().status).toBe('ACTIONED');
    expect((await call('GET', `/v1/community/models/${id}`)).statusCode).toBe(404);
  });
});

describe('Community: search', () => {
  it('finds by title, tag, and creator; filters by license; ranks a title match first', async () => {
    const tag = `t${Date.now().toString(36)}`;
    const a = await creator(auto);
    const id1 = await a.model(`Gear ${tag}`);
    const id2 = await a.model('Plain box');
    for (const [id, code, tags] of [[id1, 'CC-BY-4.0', ['gears']], [id2, 'CC0-1.0', [tag]]] as const) {
      await a.call('PUT', `/v1/assets/${id}/license`, { code });
      await a.call('POST', `/v1/community/models/${id}/publish`, { ...page, tags });
    }
    const q = (s: string) => auto.app.inject({ method: 'GET', url: `/v1/community/models?${s}` }).then((r) => r.json());
    expect((await q(`q=${tag}`)).data.map((m: { id: string }) => m.id)).toEqual([id1, id2]);
    expect((await q(`q=${tag}&license=CC0-1.0`)).data.map((m: { id: string }) => m.id)).toEqual([id2]);
    expect((await q(`tag=${tag}`)).data.map((m: { id: string }) => m.id)).toEqual([id2]);
    expect((await q(`creator=${a.handle}`)).data).toHaveLength(2);
    const none = await q(`q=zzzz${tag}nothing`);
    expect(none.data).toEqual([]);
    expect(Array.isArray(none.suggested_tags)).toBe(true);
  });

  it('makes no outbound network request while searching', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await auto.app.inject({ method: 'GET', url: '/v1/community/models?q=bracket' });
    await auto.app.inject({ method: 'GET', url: '/v1/community/models?sort=downloads' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('answers a title search over 10,000 models within 200 ms at p95', async () => {
    const owner = await creator(auto);
    const ownerId = uid(owner);
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: newId(), ownerId, kind: 'UPLOAD' as const, title: `Seed part ${i} ${['hinge', 'clip', 'knob', 'mount', 'cap'][i % 5]}`, description: 'Seeded for the search timing test.', tags: ['seed'], category: 'other', license: 'CC0-1.0', publishStatus: 'PUBLISHED' as const, visibility: 'PUBLIC' as const, publishedAt: new Date(Date.now() - i * 1000) }));
    for (let i = 0; i < rows.length; i += 2000) await auto.ctx.db.asset.createMany({ data: rows.slice(i, i + 2000) });
    const target = rows[4321]!;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = (await auto.app.inject({ method: 'GET', url: `/v1/community/models?q=${encodeURIComponent(target.title)}` })).json();
      times.push(performance.now() - t0);
      expect(r.data[0].id).toBe(toApiId('asset', target.id));
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]!).toBeLessThan(200);
    await auto.ctx.db.asset.deleteMany({ where: { ownerId } });
  });
});
