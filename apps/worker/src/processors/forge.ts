import { createHash } from 'node:crypto';
import { claimJob, failJob, forgeState, jobProgress, succeedJob, type Prisma, type Tx } from '@sw/db';
import { buildAuthorContext, runSandboxed, SandboxError, starterCode, type BuildOutput } from '@sw/forge-kit/node';
import { STARTERS } from '@sw/forge-kit';
import { DEFAULT_PROFILE, extractSchema, toPartParams, validateParams } from '@sw/forge-kit';
import { newId } from '@sw/shared';
import type { WorkerContext } from '../context';

export const EXPORT_TTL_MS = 7 * 24 * 3600_000;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const limits = (ctx: WorkerContext) => ({ timeoutMs: ctx.env.FORGE_BUILD_TIMEOUT_MS, memoryMb: ctx.env.FORGE_BUILD_MEMORY_MB });

interface ForgeBuildInput {
  prompt?: string;
  starter_key?: string;
  profile?: string;
  /** Rebuild stored code at new params: a new version of the same forge, or a fork. */
  base_version_id?: string;
  params?: Record<string, unknown>;
  mode?: 'version' | 'fork';
}

function titleFrom(prompt: string, fallback: string): string {
  const t = prompt.replace(/\[\[[^\]]*\]\]/g, '').trim();
  if (!t) return fallback;
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
}

export async function storeFile(
  ctx: WorkerContext,
  tx: Tx,
  a: { ownerId: string | null; assetVersionId: string | null; role: Prisma.AssetFileCreateInput['role']; body: Buffer; contentType: string; filename: string; keyPrefix: string; ext: string; expiresAt?: Date | null },
) {
  const id = newId();
  const key = `${a.keyPrefix}/${id}.${a.ext}`;
  await ctx.storage.put(key, a.body, a.contentType);
  return tx.assetFile.create({
    data: {
      id,
      ownerId: a.ownerId,
      assetVersionId: a.assetVersionId,
      role: a.role,
      storageKey: key,
      contentType: a.contentType,
      filename: a.filename,
      sha256: sha(a.body),
      bytes: a.body.length,
      expiresAt: a.expiresAt ?? null,
    },
  });
}

/**
 * FORGE_BUILD (build prompt 3.2): author → static check → sandboxed build → verify; on a
 * failure the error goes back to the author for exactly one repair attempt. A second
 * failure fails the job with FORGE_BUILD_FAILED and releases the credits.
 */
export async function processForgeBuild(ctx: WorkerContext, jobId: string): Promise<void> {
  const job = await claimJob(ctx.db, jobId, ctx.workerId);
  if (!job) return;
  const input = job.input as unknown as ForgeBuildInput;
  if (input.base_version_id) return rebuildVersion(ctx, job, input);
  const profile = input.profile ?? DEFAULT_PROFILE;
  let previous: { code: string; error: string } | undefined;
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < 2; attempt++) {
    await forgeState(ctx.db, job, 'AUTHORING', { attempt });
    await jobProgress(ctx.db, job.id, 10 + attempt * 40, { phase: attempt ? 'repairing' : 'authoring' });
    let code: string;
    let templateKey: string | undefined;
    let notes: string[] = [];
    try {
      const starter = input.starter_key ? STARTERS.find((x) => x.key === input.starter_key) : undefined;
      const r = starter
        ? { code: starterCode(starter.key), templateKey: starter.key, notes: [`Started from the ${starter.title} starter.`] }
        : await ctx.author.author(input.prompt ?? '', buildAuthorContext(previous));
      code = r.code;
      templateKey = r.templateKey;
      notes = r.notes;
    } catch (e) {
      lastError = `Author error: ${(e as Error).message}`;
      break;
    }
    await forgeState(ctx.db, job, 'STATIC_CHECK');
    let build: BuildOutput;
    try {
      await forgeState(ctx.db, job, 'BUILDING');
      await jobProgress(ctx.db, job.id, 20 + attempt * 40, { phase: 'building' });
      build = (await runSandboxed({ op: 'build', code, profile, stl: true, thumbnail: true }, limits(ctx))).build!;
    } catch (e) {
      lastError = e instanceof SandboxError ? `${e.code}: ${e.message}` : String(e);
      previous = { code, error: lastError };
      continue;
    }
    await forgeState(ctx.db, job, 'VERIFYING');
    const notManifold = build.report.subparts.filter((s) => !s.watertight).map((s) => s.name);
    if (notManifold.length || !build.report.verifyOk) {
      const failing = build.report.checks.filter((c) => c.status === 'fail').map((c) => c.message);
      lastError = notManifold.length ? `Not a closed, manifold mesh: ${notManifold.join(', ')}` : `Verify failed: ${failing.join('; ') || 'design checks did not pass'}`;
      previous = { code, error: lastError };
      continue;
    }

    // READY: save the forge as an asset with its source, schema, preview mesh, and thumbnail.
    const schema = extractSchema(build.parameters, build.defaults);
    const defaults = validateParams(schema, {}).values;
    await succeedJob(ctx.db, job.id, { actualCredits: job.reservedCredits }, async (tx, j) => {
      const asset = await tx.asset.create({
        data: { ownerId: j.ownerId!, kind: 'FORGE', title: input.prompt ? titleFrom(input.prompt, build.meta?.title ?? 'Forge') : (build.meta?.title ?? 'Forge'), prompt: input.prompt ?? null, license: 'ALL-RIGHTS-RESERVED' },
      });
      const version = await tx.assetVersion.create({
        data: {
          assetId: asset.id,
          number: 1,
          stage: 'FORGE',
          jobId: j.id,
          params: defaults,
          bboxMm: build.report.bbox,
          triangles: build.report.subparts.reduce((n, s) => n + s.triangles, 0),
          isWatertight: build.report.subparts.every((s) => s.watertight),
          analysis: build.report as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.forgeSource.create({
        data: {
          assetVersionId: version.id,
          code,
          schema: schema as unknown as Prisma.InputJsonValue,
          defaults: build.defaults as Prisma.InputJsonValue,
          author: input.starter_key ? 'starter' : ctx.author.key,
          authorVersion: input.starter_key ? 'starter-1' : ctx.author.version,
          templateKey: templateKey ?? null,
          dfmProfile: profile,
          checks: build.report.checks as unknown as Prisma.InputJsonValue,
          buildState: 'READY',
        },
      });
      const prefix = `assets/${asset.id}/${version.id}`;
      if (build.stl) await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: version.id, role: 'PREVIEW_MESH', body: build.stl, contentType: 'model/stl', filename: 'preview.stl', keyPrefix: prefix, ext: 'stl' });
      if (build.thumbnail) await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: version.id, role: 'THUMBNAIL', body: build.thumbnail, contentType: 'image/png', filename: 'thumbnail.png', keyPrefix: prefix, ext: 'png' });
      await tx.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
      await tx.job.update({
        where: { id: j.id },
        data: { assetId: asset.id, assetVersionId: version.id, forgeState: 'READY', output: { asset_id: asset.id, version_id: version.id, notes, warnings: build.warnings, repaired: attempt > 0 } },
      });
      await tx.jobEvent.create({ data: { jobId: j.id, type: 'forge_state', data: { from: 'VERIFYING', to: 'READY' } } });
    });
    return;
  }
  await failJob(ctx.db, job.id, { code: 'FORGE_BUILD_FAILED', message: lastError });
}

interface ForgeExportInput {
  format: 'stl' | '3mf' | 'step';
  params: Record<string, unknown>;
  /** Set when the export feeds a print part: build, check, analyze, and attach. */
  print_part_id?: string;
}

const EXPORT_META = {
  stl: { role: 'STL' as const, ct: 'model/stl', ext: 'stl' },
  '3mf': { role: 'THREEMF' as const, ct: 'model/3mf', ext: '3mf' },
  step: { role: 'STEP' as const, ct: 'application/step', ext: 'step' },
};

/** FORGE_EXPORT: build at the given params and store the file for 7 days. */
export async function processForgeExport(ctx: WorkerContext, jobId: string): Promise<void> {
  const job = await claimJob(ctx.db, jobId, ctx.workerId);
  if (!job) return;
  const input = job.input as unknown as ForgeExportInput;
  if (input.print_part_id) return exportForPrint(ctx, job.id, job.assetVersionId!, input);
  try {
    const source = await ctx.db.forgeSource.findUniqueOrThrow({ where: { assetVersionId: job.assetVersionId! }, include: { assetVersion: { include: { asset: true } } } });
    const schema = source.schema as unknown as Parameters<typeof validateParams>[0];
    const { values } = validateParams(schema, input.params ?? {});
    await jobProgress(ctx.db, job.id, 30, { phase: `exporting ${input.format.toUpperCase()}` });
    const { file } = await runSandboxed({ op: 'export', code: source.code, format: input.format, params: toPartParams(schema, values) }, limits(ctx));
    const meta = EXPORT_META[input.format];
    const base = source.assetVersion.asset.title.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'forge';
    await succeedJob(ctx.db, job.id, { actualCredits: job.reservedCredits }, async (tx, j) => {
      const f = await storeFile(ctx, tx, {
        ownerId: j.ownerId,
        assetVersionId: job.assetVersionId,
        role: meta.role,
        body: file!,
        contentType: meta.ct,
        filename: `${base}.${meta.ext}`,
        keyPrefix: `exports/${source.assetVersion.assetId}`,
        ext: meta.ext,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      });
      await tx.job.update({ where: { id: j.id }, data: { output: { file_id: f.id, format: input.format, bytes: f.bytes, params: values } } });
    });
  } catch (e) {
    const code = e instanceof SandboxError ? (e.code === 'FORGE_BUILD_TIMEOUT' ? 'FORGE_BUILD_TIMEOUT' : 'FORGE_BUILD_FAILED') : 'FORGE_BUILD_FAILED';
    await failJob(ctx.db, job.id, { code, message: (e as Error).message });
  }
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

/**
 * Save settings as a new version, or fork (ADR-027): rebuild the stored code at new params
 * in the sandbox, compute checks and a thumbnail, and write the version. No author runs,
 * so there is no repair attempt: a build failure fails the job.
 */
async function rebuildVersion(ctx: WorkerContext, job: ClaimedJob, input: ForgeBuildInput): Promise<void> {
  const base = await ctx.db.assetVersion.findUnique({ where: { id: input.base_version_id! }, include: { forgeSource: true, asset: true, files: true } });
  if (!base?.forgeSource) return void (await failJob(ctx.db, job.id, { code: 'NOT_FOUND', message: 'The base version no longer exists' }));
  const src = base.forgeSource;
  const schema = src.schema as unknown as Parameters<typeof validateParams>[0];
  const { values } = validateParams(schema, input.params ?? ((base.params as Record<string, unknown>) ?? {}));
  await forgeState(ctx.db, job, 'AUTHORING', { reused_code: true });
  await forgeState(ctx.db, job, 'STATIC_CHECK');
  await forgeState(ctx.db, job, 'BUILDING');
  await jobProgress(ctx.db, job.id, 30, { phase: 'building' });
  let build: BuildOutput;
  try {
    build = (await runSandboxed({ op: 'build', code: src.code, params: toPartParams(schema, values), profile: src.dfmProfile, stl: true, thumbnail: true }, limits(ctx))).build!;
  } catch (e) {
    return void (await failJob(ctx.db, job.id, { code: 'FORGE_BUILD_FAILED', message: e instanceof SandboxError ? e.message : String(e) }));
  }
  await forgeState(ctx.db, job, 'VERIFYING');
  await succeedJob(ctx.db, job.id, { actualCredits: 0 }, async (tx, j) => {
    let assetId = base.assetId;
    let number: number;
    if (input.mode === 'fork') {
      const fork = await tx.asset.create({
        data: { ownerId: j.ownerId!, kind: 'FORGE', title: `${base.asset.title} (fork)`.slice(0, 120), prompt: base.asset.prompt, forkedFromId: base.assetId, license: base.asset.license },
      });
      assetId = fork.id;
      number = 1;
    } else {
      const last = await tx.assetVersion.findFirst({ where: { assetId }, orderBy: { number: 'desc' } });
      number = (last?.number ?? 0) + 1;
    }
    const version = await tx.assetVersion.create({
      data: {
        assetId,
        number,
        stage: 'FORGE',
        jobId: j.id,
        parentVersionId: base.id,
        params: values,
        bboxMm: build.report.bbox,
        triangles: build.report.subparts.reduce((n, s) => n + s.triangles, 0),
        isWatertight: build.report.subparts.every((s) => s.watertight),
        analysis: build.report as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.forgeSource.create({
      data: {
        assetVersionId: version.id,
        code: src.code,
        schema: src.schema as Prisma.InputJsonValue,
        defaults: src.defaults as Prisma.InputJsonValue,
        author: src.author,
        authorVersion: src.authorVersion,
        templateKey: src.templateKey,
        dfmProfile: src.dfmProfile,
        checks: build.report.checks as unknown as Prisma.InputJsonValue,
        buildState: 'READY',
      },
    });
    const prefix = `assets/${assetId}/${version.id}`;
    if (build.stl) await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: version.id, role: 'PREVIEW_MESH', body: build.stl, contentType: 'model/stl', filename: 'preview.stl', keyPrefix: prefix, ext: 'stl' });
    if (build.thumbnail) await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: version.id, role: 'THUMBNAIL', body: build.thumbnail, contentType: 'image/png', filename: 'thumbnail.png', keyPrefix: prefix, ext: 'png' });
    await tx.asset.update({ where: { id: assetId }, data: { currentVersionId: version.id } });
    await tx.job.update({ where: { id: j.id }, data: { assetId, assetVersionId: version.id, forgeState: 'READY', output: { asset_id: assetId, version_id: version.id, number, mode: input.mode ?? 'version' } } });
    await tx.jobEvent.create({ data: { jobId: j.id, type: 'forge_state', data: { from: 'VERIFYING', to: 'READY' } } });
  });
}

/**
 * "Send to print" from a forge (build prompt 3.3): rebuild at the chosen params in the
 * sandbox, store the STL, run mesh analysis, and record whether checks fail. A part with
 * failing checks cannot reach the cart until they are acknowledged.
 */
async function exportForPrint(ctx: WorkerContext, jobId: string, versionId: string, input: ForgeExportInput): Promise<void> {
  const partId = input.print_part_id!;
  try {
    const source = await ctx.db.forgeSource.findUniqueOrThrow({ where: { assetVersionId: versionId } });
    const schema = source.schema as unknown as Parameters<typeof validateParams>[0];
    const { values } = validateParams(schema, input.params ?? {});
    const { build } = await runSandboxed({ op: 'build', code: source.code, params: toPartParams(schema, values), profile: source.dfmProfile, stl: true }, limits(ctx));
    const analysis = await ctx.mesh.analyze(build!.stl!, 'stl');
    const failing = build!.report.checks.filter((c) => c.status === 'fail');
    await succeedJob(ctx.db, jobId, { actualCredits: 0 }, async (tx, j) => {
      const f = await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: null, role: 'STL', body: build!.stl!, contentType: 'model/stl', filename: 'forge.stl', keyPrefix: `print-parts/${partId}`, ext: 'stl' });
      await tx.printPart.update({
        where: { id: partId },
        data: {
          sourceFileId: f.id,
          analysis: analysis as object,
          validationReport: { analysis, checks: build!.report.checks, params: values } as object,
          status: analysis.watertight && analysis.manifold ? 'READY' : 'NEEDS_REPAIR',
          checksFailing: failing.length > 0,
        },
      });
      await tx.job.update({ where: { id: j.id }, data: { output: { part_id: partId, checks_failing: failing.length > 0 } } });
    });
  } catch (e) {
    await ctx.db.printPart.update({ where: { id: partId }, data: { status: 'REJECTED', validationReport: { error: (e as Error).message } } }).catch(() => undefined);
    await failJob(ctx.db, jobId, { code: 'FORGE_BUILD_FAILED', message: (e as Error).message });
  }
}
