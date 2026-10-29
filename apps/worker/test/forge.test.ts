import { afterAll, describe, expect, it } from 'vitest';
import { createJob, ledgerSum, onboardUser } from '@sw/db';
import { processForgeBuild, processForgeExport } from '../src/processors/forge';
import { makeWorkerCtx } from './helpers';

const ctx = makeWorkerCtx();
afterAll(() => ctx.close());

async function user() {
  return (await ctx.db.$transaction((tx) => onboardUser(tx, { email: `f-${crypto.randomUUID()}@example.test` }))).userId;
}
async function forgeJob(ownerId: string, input: object, reserve = 10) {
  const { job } = await ctx.db.$transaction((tx) =>
    createJob(tx, { ownerId, kind: 'FORGE_BUILD', idempotencyKey: crypto.randomUUID(), input: input as never, reserveCredits: reserve, timeoutMs: 600_000, maxAttempts: 1 }),
  );
  return job;
}
const wallet = (ownerId: string) => ctx.db.creditWallet.findUniqueOrThrow({ where: { ownerId } });
const states = async (jobId: string) =>
  (await ctx.db.jobEvent.findMany({ where: { jobId, type: 'forge_state' }, orderBy: { seq: 'asc' } })).map((e) => (e.data as { to: string }).to);

describe('FORGE_BUILD', () => {
  it('authors, builds, verifies, saves the forge, and commits credits', async () => {
    const owner = await user();
    const job = await forgeJob(owner, { prompt: 'a 40 mm cable clip for a 6 mm cable, with a snap closure' });
    expect((await wallet(owner)).reserved).toBe(10);
    await processForgeBuild(ctx, job.id);
    const done = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.forgeState).toBe('READY');
    expect(await states(job.id)).toEqual(['AUTHORING', 'STATIC_CHECK', 'BUILDING', 'VERIFYING', 'READY']);
    const w = await wallet(owner);
    expect([w.balance, w.reserved]).toEqual([90, 0]);
    expect(await ledgerSum(ctx.db, w.id)).toBe(90);
    const asset = await ctx.db.asset.findUniqueOrThrow({ where: { id: done.assetId! }, include: { versions: { include: { forgeSource: true, files: true } } } });
    expect(asset.kind).toBe('FORGE');
    const v = asset.versions[0]!;
    expect(v.forgeSource!.templateKey).toBe('cable-clip');
    expect((v.params as Record<string, number>).width).toBe(40);
    expect(v.files.map((f) => f.role).sort()).toEqual(['PREVIEW_MESH', 'THUMBNAIL']);
    expect((await ctx.storage.get(v.files.find((f) => f.role === 'THUMBNAIL')!.storageKey)).subarray(1, 4).toString()).toBe('PNG');
  });

  it('repairs once after a failed build', async () => {
    const owner = await user();
    const job = await forgeJob(owner, { prompt: 'a storage box [[broken]]' });
    await processForgeBuild(ctx, job.id);
    const done = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect((done.output as { repaired: boolean }).repaired).toBe(true);
    expect(await states(job.id)).toEqual(['AUTHORING', 'STATIC_CHECK', 'BUILDING', 'AUTHORING', 'STATIC_CHECK', 'BUILDING', 'VERIFYING', 'READY']);
  });

  it('fails with FORGE_BUILD_FAILED after the repair also fails, and releases the credits', async () => {
    const owner = await user();
    const job = await forgeJob(owner, { prompt: 'a storage box [[broken-always]]' });
    await processForgeBuild(ctx, job.id);
    const done = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('FAILED');
    expect(done.errorCode).toBe('FORGE_BUILD_FAILED');
    expect(done.errorMessage).toContain('deliberately broken');
    expect(done.forgeState).toBe('FAILED');
    const w = await wallet(owner);
    expect([w.balance, w.reserved]).toEqual([100, 0]);
    expect(await ctx.db.asset.count({ where: { ownerId: owner } })).toBe(0);
  });

  it('saves a forge with a failing check (thin wall) so the page can show it', async () => {
    const owner = await user();
    const job = await forgeJob(owner, { prompt: 'a planter 80 mm across with 0.8 mm walls' });
    await processForgeBuild(ctx, job.id);
    const done = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    const src = await ctx.db.forgeSource.findFirstOrThrow({ where: { assetVersionId: done.assetVersionId! } });
    const failing = (src.checks as { id: string; status: string; message: string }[]).filter((c) => c.status === 'fail');
    expect(failing.map((c) => c.message)).toContain('Wall is 0.8 mm; the printer minimum is 1.2 mm.');
  });

  it('saves a starter for free', async () => {
    const owner = await user();
    const job = await forgeJob(owner, { starter_key: 'planter' }, 0);
    await processForgeBuild(ctx, job.id);
    expect((await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('SUCCEEDED');
    expect((await wallet(owner)).balance).toBe(100);
  });
});

describe('FORGE_EXPORT', () => {
  it('exports STL and STEP at clamped params, with a 7-day expiry', async () => {
    const owner = await user();
    const build = await forgeJob(owner, { starter_key: 'filleted-box' }, 0);
    await processForgeBuild(ctx, build.id);
    const b = await ctx.db.job.findUniqueOrThrow({ where: { id: build.id } });
    for (const format of ['stl', 'step'] as const) {
      const { job } = await ctx.db.$transaction((tx) =>
        createJob(tx, { ownerId: owner, kind: 'FORGE_EXPORT', idempotencyKey: crypto.randomUUID(), input: { format, params: { w: 500 } }, reserveCredits: format === 'step' ? 2 : 0, timeoutMs: 600_000, assetId: b.assetId, assetVersionId: b.assetVersionId }),
      );
      await processForgeExport(ctx, job.id);
      const done = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(done.status).toBe('SUCCEEDED');
      const out = done.output as { file_id: string; params: { w: number } };
      expect(out.params.w).toBe(200);
      const f = await ctx.db.assetFile.findUniqueOrThrow({ where: { id: out.file_id } });
      expect(f.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400e3);
      const body = await ctx.storage.get(f.storageKey);
      if (format === 'step') expect(body.subarray(0, 13).toString()).toBe('ISO-10303-21;');
      else expect(body.readUInt32LE(80) * 50 + 84).toBe(body.length);
    }
    expect((await wallet(owner)).balance).toBe(98);
  });
});
