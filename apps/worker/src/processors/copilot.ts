import { type claimJob, credits, failJob, forgeState, jobProgress, succeedJob, type Prisma } from '@sw/db';
import { buildAuthorContext, runSandboxed, SandboxError, type EditResult } from '@sw/forge-kit/node';
import { analyzeFeatures, editDiff, extractSchema, featureSource, replaceFeature, staticCheck, toPartParams, validateParams, type ParamSchema, type ParamValues } from '@sw/forge-kit';
import type { WorkerContext } from '../context';

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;
const limits = (ctx: WorkerContext) => ({ timeoutMs: ctx.env.FORGE_BUILD_TIMEOUT_MS, memoryMb: ctx.env.FORGE_BUILD_MEMORY_MB });

/** Fail the proposal: the edit is marked FAILED and its held credits are released. */
async function failEdit(ctx: WorkerContext, job: ClaimedJob, editId: string, code: string, message: string) {
  await ctx.db.$transaction(async (tx) => {
    const e = await tx.copilotEdit.findUnique({ where: { id: editId } });
    if (!e || e.status !== 'PROPOSING') return;
    await tx.copilotEdit.update({ where: { id: editId }, data: { status: 'FAILED', error: message.slice(0, 1000) } });
    if (e.reservationId) await credits.release(tx, { reservationId: e.reservationId, idempotencyKey: `copilot-release:${e.id}` });
  });
  await failJob(ctx.db, job.id, { code, message });
}

/**
 * Copilot proposal (Module 6, ADR-039): the author edits the model source (never the mesh);
 * a feature edit may change only that feature's builder. The result is statically checked,
 * built and verified in the sandbox, and stored as a proposal with a diff. Nothing is saved
 * to the forge until the person accepts it.
 */
export async function proposeCopilotEdit(ctx: WorkerContext, job: ClaimedJob, editId: string): Promise<void> {
  const edit = await ctx.db.copilotEdit.findUnique({ where: { id: editId }, include: { assetVersion: { include: { forgeSource: true } } } });
  const src = edit?.assetVersion.forgeSource;
  if (!edit || !src) return failEdit(ctx, job, editId, 'NOT_FOUND', 'The version this edit is based on no longer exists');
  const schema = src.schema as unknown as ParamSchema;
  const params = validateParams(schema, (edit.assetVersion.params as Record<string, unknown>) ?? {}).values;

  await forgeState(ctx.db, job, 'AUTHORING', { copilot_edit: true });
  await jobProgress(ctx.db, job.id, 15, { phase: 'editing' });
  let result: EditResult;
  let feature: { key: string; source: string; params: string[] } | undefined;
  if (edit.targetFeatureKey) {
    const f = analyzeFeatures(src.code).features.find((x) => x.key === edit.targetFeatureKey);
    if (!f) return failEdit(ctx, job, editId, 'FORGE_NOT_FEATURED', `The model has no feature "${edit.targetFeatureKey}"`);
    feature = { key: f.key, source: featureSource(src.code, f.key)!, params: f.params };
  }
  try {
    result = await ctx.author.edit({ code: src.code, message: edit.userMessage, schema, params, ...(feature ? { feature } : {}) }, buildAuthorContext());
  } catch (e) {
    const code = (e as { code?: string }).code === 'AUTHOR_DECLINED' ? 'AUTHOR_DECLINED' : 'FORGE_BUILD_FAILED';
    return failEdit(ctx, job, editId, code, (e as Error).message);
  }

  // A feature edit changes only that builder: the platform applies it, not the author.
  let code = src.code;
  try {
    if (feature) {
      if (!result.featureSource) throw new Error('The author did not return the edited feature');
      code = replaceFeature(src.code, feature.key, result.featureSource);
    } else if (result.code) {
      code = result.code;
    }
  } catch (e) {
    return failEdit(ctx, job, editId, 'FORGE_BUILD_FAILED', (e as Error).message);
  }
  await forgeState(ctx.db, job, 'STATIC_CHECK');
  const check = staticCheck(code);
  if (!check.ok) return failEdit(ctx, job, editId, 'FORGE_STATIC_CHECK_FAILED', check.issues.map((i) => i.message).join('; '));
  const fa = analyzeFeatures(code);
  if (code !== src.code && analyzeFeatures(src.code).featured && !fa.featured) return failEdit(ctx, job, editId, 'FORGE_BUILD_FAILED', `The edit broke the named features: ${fa.issues.join('; ')}`);

  await forgeState(ctx.db, job, 'BUILDING');
  await jobProgress(ctx.db, job.id, 40, { phase: 'building' });
  let newSchema = schema;
  let newParams: ParamValues;
  let build;
  try {
    if (code !== src.code) {
      // New code may change the schema: read it from a first build at defaults.
      const probe = (await runSandboxed({ op: 'build', code }, limits(ctx))).build!;
      newSchema = extractSchema(probe.parameters, probe.defaults);
    }
    newParams = validateParams(newSchema, { ...params, ...(result.params ?? {}) }).values;
    build = (await runSandboxed({ op: 'build', code, params: toPartParams(newSchema, newParams), profile: src.dfmProfile }, limits(ctx))).build!;
  } catch (e) {
    return failEdit(ctx, job, editId, 'FORGE_BUILD_FAILED', e instanceof SandboxError ? e.message : String(e));
  }
  await forgeState(ctx.db, job, 'VERIFYING');
  if (!build.report.subparts.every((s) => s.watertight)) return failEdit(ctx, job, editId, 'FORGE_BUILD_FAILED', 'The edited model is not a closed, manifold mesh');

  const diff = editDiff({ oldCode: src.code, newCode: code, oldParams: params, newParams, newSchema, oldBbox: (edit.assetVersion.bboxMm as number[] | null) ?? null, newBbox: build.report.bbox });
  if (!diff.code_changed && diff.params.length === 0) return failEdit(ctx, job, editId, 'AUTHOR_DECLINED', 'The edit did not change anything');
  await succeedJob(ctx.db, job.id, { actualCredits: 0, output: { copilot_edit_id: edit.id } }, async (tx) => {
    // A proposal rejected while it was being built stays rejected.
    await tx.copilotEdit.updateMany({
      where: { id: edit.id, status: 'PROPOSING' },
      data: {
        status: 'PROPOSED',
        proposedCode: code,
        proposedParams: newParams as Prisma.InputJsonValue,
        proposedSchema: newSchema as unknown as Prisma.InputJsonValue,
        diff: diff as unknown as Prisma.InputJsonValue,
        preview: { bbox_mm: build.report.bbox, checks: build.report.checks, checks_failing: build.report.checks.some((c) => c.status === 'fail') } as unknown as Prisma.InputJsonValue,
        notes: result.notes.slice(0, 10),
      },
    });
    await tx.job.update({ where: { id: job.id }, data: { forgeState: 'READY' } });
  });
}
