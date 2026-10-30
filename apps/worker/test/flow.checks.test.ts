import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from '@sw/api/testing';
import { fromApiId } from '@sw/shared';
import { MeshClient } from '@sw/shared/node';
import { fsStorage } from '@sw/storage';
import { dispatchForge } from '../src/dispatch';
import { makeWorkerCtx } from './helpers';
import { startMeshService } from './mesh-service';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let mesh: { url: string; stop: () => void };
const w = makeWorkerCtx();
beforeAll(async () => {
  mesh = await startMeshService();
  t = await makeTestApp({ STORAGE_DIR: w.env.STORAGE_DIR, MESH_URL: mesh.url });
  Object.assign(w, { storage: fsStorage({ dir: w.env.STORAGE_DIR, secret: w.env.APP_SECRET, publicBase: w.env.PUBLIC_FILES_BASE }), mesh: new MeshClient({ url: mesh.url, token: w.env.MESH_SERVICE_TOKEN }) });
}, 120_000);
afterAll(async () => {
  await t.close();
  await w.close();
  mesh.stop();
});
const key = () => `k-${crypto.randomUUID()}`;
const run = (jobApiId: string) => dispatchForge(w, fromApiId('job', jobApiId)!);

describe('printability checks and estimates (M6-D)', () => {
  it('a 200 mm part passes bed fit on the generic profile and fails on a 180 mm bed; checks include manifold, layers, and labeled estimates', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const job = (await call('POST', '/v1/forges', { prompt: 'a planter 200 mm across' }, { 'idempotency-key': key() })).json().job;
    await run(job.id);
    const id = (await call('GET', `/v1/jobs/${job.id}`)).json().output.forge_id as string;

    const pending = (await call('GET', `/v1/forges/${id}/checks`)).json();
    expect(pending.status).toBe('pending');
    await run(pending.job.id);
    const generic = (await call('GET', `/v1/forges/${id}/checks`)).json();
    expect(generic.status).toBe('ready');
    expect(generic.printer.key).toBe('generic-fdm');
    const byId = (r: { checks: { id: string; status: string; message: string }[] }, cid: string) => r.checks.find((c) => c.id === cid)!;
    expect(byId(generic, 'bed-fit').status).toBe('pass');
    expect(byId(generic, 'mesh-manifold').status).toBe('pass');
    expect(byId(generic, 'layers')).toMatchObject({ status: 'pass' });
    expect(byId(generic, 'layers').message).toMatch(/0\.2 mm/);
    expect(generic.checks.some((c: { id: string }) => c.id.startsWith('overhang:'))).toBe(true);
    expect(generic.checks.some((c: { id: string }) => c.id.startsWith('min-wall:'))).toBe(true);
    expect(generic.send_to_print_blocked).toBe(false);
    expect(generic.estimates).toHaveLength(1);
    expect(generic.estimates[0]).toMatchObject({ code: 'ESTIMATE_NOT_CERTIFIED', label: 'Estimate, not a certified load test.', formula: 'θ = atan(d / h)' });

    const profiles = (await call('GET', '/v1/printer-profiles')).json().data as { id: string; key: string }[];
    const mini = profiles.find((p) => p.key === 'prusa-mini-plus')!;
    const p1 = (await call('GET', `/v1/forges/${id}/checks?profile_id=${mini.id}`)).json();
    await run(p1.job.id);
    const small = (await call('GET', `/v1/forges/${id}/checks?profile_id=${mini.id}`)).json();
    expect(byId(small, 'bed-fit').status).toBe('fail');
    expect(byId(small, 'bed-fit').message).toContain('larger than the 180 × 180 × 180 mm bed');
    expect(small.send_to_print_blocked).toBe(true);
  }, 120_000);
});
