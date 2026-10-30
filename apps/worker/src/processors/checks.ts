import { failJob, Prisma, succeedJob, type claimJob } from '@sw/db';
import { runSandboxed, SandboxError } from '@sw/forge-kit/node';
import { baseFootprint, tipOverEstimate, type Estimate, toPartParams, validateParams, type DfmProfileObject, type ForgeCheck, type ParamSchema } from '@sw/forge-kit';
import type { WorkerContext } from '../context';
import { parseBinaryStl } from './stl-positions';

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

/**
 * Printability checks on the server (Module 6, section 5): the sandbox build under the
 * chosen printer profile (bed fit, walls, overhangs), the mesh service's manifold analysis
 * and layer sanity, and the tip-over estimate. Cached per version and profile.
 */
export async function runForgeChecks(ctx: WorkerContext, job: ClaimedJob, input: { checks_profile: DfmProfileObject; profile_key: string }): Promise<void> {
  const src = await ctx.db.forgeSource.findUnique({ where: { assetVersionId: job.assetVersionId! }, include: { assetVersion: true } });
  if (!src) return void (await failJob(ctx.db, job.id, { code: 'NOT_FOUND', message: 'Version not found' }));
  const schema = src.schema as unknown as ParamSchema;
  const { values } = validateParams(schema, (src.assetVersion.params as Record<string, unknown>) ?? {});
  let build;
  try {
    build = (await runSandboxed({ op: 'build', code: src.code, params: toPartParams(schema, values), profile: input.checks_profile as never, stl: true }, { timeoutMs: ctx.env.FORGE_BUILD_TIMEOUT_MS, memoryMb: ctx.env.FORGE_BUILD_MEMORY_MB })).build!;
  } catch (e) {
    return void (await failJob(ctx.db, job.id, { code: 'FORGE_BUILD_FAILED', message: e instanceof SandboxError ? e.message : String(e) }));
  }
  const checks: ForgeCheck[] = [...build.report.checks];
  let slice: Record<string, unknown> | null = null;
  if (build.stl) {
    const a = await ctx.mesh.analyze(build.stl, 'stl', { buildVolume: input.checks_profile.bed as [number, number, number] });
    checks.push({
      id: 'mesh-manifold',
      status: a.watertight && a.manifold ? 'pass' : 'fail',
      title: 'Manifold and watertight (mesh analysis)',
      message: a.watertight && a.manifold ? 'The exported mesh is closed and manifold.' : `The exported mesh has ${a.boundary_edges} open and ${a.nonmanifold_edges} non-manifold edges.`,
    });
    const sc = await ctx.mesh.sliceCheck(build.stl, 'stl', 0.2);
    slice = sc as unknown as Record<string, unknown>;
    const problems = [
      sc.empty_count ? `${sc.empty_count} empty layer${sc.empty_count === 1 ? '' : 's'} inside the part (floating pieces)` : null,
      sc.open_count ? `${sc.open_count} layer${sc.open_count === 1 ? '' : 's'} with open outlines` : null,
      sc.self_intersecting_count ? `${sc.self_intersecting_count} layer${sc.self_intersecting_count === 1 ? '' : 's'} whose outlines cross themselves` : null,
    ].filter(Boolean);
    checks.push({
      id: 'layers',
      status: problems.length ? 'warn' : 'pass',
      title: 'Layer sanity',
      message: problems.length ? `At ${sc.layer_mm} mm layers: ${problems.join('; ')}.` : `Slices into ${sc.layers} layers at ${sc.layer_mm} mm with closed, non-crossing outlines.`,
      measured: sc.layers,
    });
  }
  const estimates: Estimate[] = [];
  if (build.stl && build.report.subparts.length === 1 && build.report.subparts[0]!.centerOfMass) {
    const pos = parseBinaryStl(build.stl);
    estimates.push(tipOverEstimate({ centerOfMass: build.report.subparts[0]!.centerOfMass, footprint: baseFootprint(pos) }));
  }
  await succeedJob(ctx.db, job.id, { actualCredits: 0, output: { profile_key: input.profile_key } }, async (tx) => {
    await tx.forgeCheckRun.upsert({
      where: { assetVersionId_profileKey: { assetVersionId: src.assetVersionId, profileKey: input.profile_key } },
      update: { profile: input.checks_profile as unknown as Prisma.InputJsonValue, checks: checks as unknown as Prisma.InputJsonValue, estimates: estimates as unknown as Prisma.InputJsonValue, slice: (slice ?? Prisma.DbNull) as Prisma.InputJsonValue },
      create: { assetVersionId: src.assetVersionId, profileKey: input.profile_key, profile: input.checks_profile as unknown as Prisma.InputJsonValue, checks: checks as unknown as Prisma.InputJsonValue, estimates: estimates as unknown as Prisma.InputJsonValue, slice: (slice ?? Prisma.DbNull) as Prisma.InputJsonValue },
    });
  });
}
