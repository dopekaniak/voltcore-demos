import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, printApi, toApiId } from '@sw/shared';
import { MeshServiceError } from '@sw/shared/node';
import { createJob, type PrintPart } from '@sw/db';
import { validateParams, type ParamSchema } from '@sw/forge-kit';
import type { AppContext } from '../context';
import { idOr404, readableAsset } from '../lib/access';
import { assertAssetNotSafetyCritical } from '../lib/catalog';
import { mergeSettings, serializeQuote, storeQuote } from '../lib/quote';
import { requireUser, route } from '../lib/route';
import { iso, serializeJob } from '../lib/serialize';
import { ensureAnonId } from '../plugins/auth';

const ANON_TTL_MS = 24 * 3600_000;

export function serializePart(p: PrintPart, jobId: string | null = null) {
  const repair = p.repairReport as { before: Record<string, unknown> | null; after: Record<string, unknown>; actions: string[] } | null;
  return {
    id: toApiId('part', p.id),
    title: p.title,
    status: p.status,
    source: (p.uploadId ? 'upload' : p.forgeVersionId ? 'forge' : 'asset') as 'upload' | 'forge' | 'asset',
    analysis: (p.analysis ?? null) as Record<string, unknown> | null,
    repair: repair ? { before: repair.before ?? null, after: repair.after, actions: repair.actions } : null,
    use_repaired: p.useRepaired,
    settings: (p.settings ?? {}) as Record<string, unknown>,
    checks_failing: p.checksFailing,
    checks_acknowledged: p.checksAcknowledgedAt !== null,
    job_id: jobId,
    expires_at: iso(p.expiresAt),
    created_at: p.createdAt.toISOString(),
  };
}

/** Parts belong to a user, or to an anonymous visitor (24 h) until they sign in. */
export async function ownPart(ctx: AppContext, req: FastifyRequest, apiId: string): Promise<PrintPart> {
  const p = await ctx.db.printPart.findUnique({ where: { id: idOr404('part', apiId, 'Part') } });
  const mine = p && ((req.auth.userId && p.ownerId === req.auth.userId) || (!p.ownerId && req.auth.anonId && p.anonId === req.auth.anonId));
  if (!p || !mine) throw new AppError('NOT_FOUND', 'Part not found');
  if (!p.ownerId && p.expiresAt && p.expiresAt <= ctx.now()) throw new AppError('NOT_FOUND', 'This upload has expired');
  return p;
}

export function printRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, printApi.createPart, async ({ body, idempotencyKey }, req, reply) => {
    const userId = req.auth.userId;
    const owner = userId ? { ownerId: userId, anonId: null } : { ownerId: null, anonId: ensureAnonId(req, reply, ctx) };
    const expiresAt = userId ? null : new Date(ctx.now().getTime() + ANON_TTL_MS);
    const settings = mergeSettings({ settings: {} } as PrintPart);

    if ('upload_id' in body) {
      const up = await ctx.db.upload.findUnique({ where: { id: idOr404('upload', body.upload_id, 'Upload') } });
      const mine = up && ((userId && up.ownerId === userId) || (!up.ownerId && req.auth.anonId && up.anonId === req.auth.anonId));
      if (!up || !mine || up.purpose !== 'PRINT') throw new AppError('NOT_FOUND', 'Upload not found');
      if (up.status !== 'CLEAN') throw new AppError('INVALID_STATE', 'Finish the upload first');
      const ext = up.filename.toLowerCase().split('.').pop() as 'stl' | 'obj' | '3mf';
      let analysis;
      try {
        analysis = await ctx.mesh.analyze(await ctx.storage.get(up.storageKey), ext);
      } catch (e) {
        if (e instanceof MeshServiceError && e.status === 422) throw new AppError('UPLOAD_REJECTED', e.message);
        throw new AppError('MESH_SERVICE_ERROR', 'The file could not be analyzed right now');
      }
      const part = await ctx.db.printPart.create({
        data: { ...owner, title: up.filename, uploadId: up.id, status: analysis.watertight && analysis.manifold ? 'READY' : 'NEEDS_REPAIR', analysis: analysis as object, validationReport: analysis as object, settings, expiresAt },
      });
      return { part: serializePart(part) };
    }

    if ('asset_version_id' in body) {
      const v = await ctx.db.assetVersion.findUnique({ where: { id: idOr404('version', body.asset_version_id, 'Version') }, include: { files: true } });
      if (!v) throw new AppError('NOT_FOUND', 'Version not found');
      const { asset } = await readableAsset(ctx.db, req, v.assetId);
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Sign in to print library models');
      await assertAssetNotSafetyCritical(ctx.db, asset.id);
      const file = v.files.find((f) => f.role === 'STL') ?? v.files.find((f) => f.role === 'PREVIEW_MESH');
      if (!file) throw new AppError('INVALID_STATE', 'This version has no printable mesh');
      const analysis = await ctx.mesh.analyze(await ctx.storage.get(file.storageKey), 'stl');
      const part = await ctx.db.printPart.create({
        data: { ...owner, title: asset.title, assetVersionId: v.id, sourceFileId: file.id, status: analysis.watertight && analysis.manifold ? 'READY' : 'NEEDS_REPAIR', analysis: analysis as object, validationReport: analysis as object, settings },
      });
      return { part: serializePart(part) };
    }

    // From a forge: the server rebuilds at the given params in the sandbox and checks it.
    if (!userId) throw new AppError('UNAUTHENTICATED', 'Sign in to print a forge');
    const { asset } = await readableAsset(ctx.db, req, idOr404('forge', body.forge_id, 'Forge'), 'FORGE');
    const v = await ctx.db.assetVersion.findFirst({
      where: { assetId: asset.id, ...(body.version_id ? { id: idOr404('version', body.version_id, 'Version') } : {}) },
      orderBy: { number: 'desc' },
      include: { forgeSource: true },
    });
    if (!v?.forgeSource) throw new AppError('NOT_FOUND', 'Version not found');
    const params = validateParams(v.forgeSource.schema as unknown as ParamSchema, body.params).values;
    const result = await ctx.db.$transaction(async (tx) => {
      const part = await tx.printPart.create({
        data: { ...owner, title: asset.title, forgeVersionId: v.id, status: 'ANALYZING', settings, ...(body.acknowledge_checks ? { checksAcknowledgedAt: ctx.now() } : {}) },
      });
      const { job } = await createJob(tx, {
        ownerId: userId,
        kind: 'FORGE_EXPORT',
        idempotencyKey: `print-part:${idempotencyKey}`,
        input: { format: 'stl', params, print_part_id: part.id },
        reserveCredits: 0,
        timeoutMs: 10 * 60_000,
        assetId: asset.id,
        assetVersionId: v.id,
        maxAttempts: 2,
      });
      return { part, job };
    });
    return { part: serializePart(result.part, toApiId('job', result.job.id)) };
  });

  route(app, ctx, printApi.getPart, async ({ params }, req) => ({ part: serializePart(await ownPart(ctx, req, params.id)) }));

  route(app, ctx, printApi.patchPart, async ({ params, body }, req) => {
    let part = await ownPart(ctx, req, params.id);
    const settings = mergeSettings(part, body.settings);
    part = await ctx.db.printPart.update({
      where: { id: part.id },
      data: {
        settings,
        ...(body.use_repaired !== undefined ? { useRepaired: body.use_repaired && part.repairedFileId !== null } : {}),
        ...(body.acknowledge_checks === true ? { checksAcknowledgedAt: ctx.now() } : body.acknowledge_checks === false ? { checksAcknowledgedAt: null } : {}),
      },
    });
    if (!['READY', 'NEEDS_REPAIR'].includes(part.status)) return { part: serializePart(part), quote: null };
    const p = part;
    const quote = await ctx.db.$transaction((tx) => storeQuote(tx, ctx.env, p, settings, ctx.now()));
    return { part: serializePart(part), quote: serializeQuote(ctx.env, quote, ctx.now()) };
  });

  route(app, ctx, printApi.partMeshUrl, async ({ params, query }, req) => {
    const part = await ownPart(ctx, req, params.id);
    let key: string | null = null;
    let format = 'stl';
    if (query.which === 'repaired') {
      const f = part.repairedFileId ? await ctx.db.assetFile.findUnique({ where: { id: part.repairedFileId } }) : null;
      key = f?.storageKey ?? null;
    } else if (part.uploadId) {
      const up = await ctx.db.upload.findUnique({ where: { id: part.uploadId } });
      key = up?.storageKey ?? null;
      format = up?.filename.toLowerCase().split('.').pop() ?? 'stl';
    } else if (part.sourceFileId) {
      key = (await ctx.db.assetFile.findUnique({ where: { id: part.sourceFileId } }))?.storageKey ?? null;
    }
    if (!key) throw new AppError('NOT_FOUND', 'No mesh yet');
    return { url: await ctx.storage.signedGetUrl(key, { ttlS: 300 }), format };
  });

  route(app, ctx, printApi.repairPart, async ({ params, idempotencyKey }, req) => {
    const part = await ownPart(ctx, req, params.id);
    if (!['READY', 'NEEDS_REPAIR'].includes(part.status)) throw new AppError('INVALID_STATE', 'The part is not ready to repair');
    const { job } = await ctx.db.$transaction(async (tx) => {
      await tx.printPart.update({ where: { id: part.id }, data: { status: 'REPAIRING' } });
      return createJob(tx, { ownerId: part.ownerId, anonId: part.anonId, kind: 'MESH_ANALYZE', idempotencyKey: idempotencyKey!, input: { op: 'repair', print_part_id: part.id }, reserveCredits: 0, timeoutMs: 10 * 60_000 });
    });
    return { job: serializeJob(job) };
  });

  route(app, ctx, printApi.createQuote, async ({ body, idempotencyKey }, req) => {
    const part = await ownPart(ctx, req, body.part_id);
    if (!['READY', 'NEEDS_REPAIR'].includes(part.status)) throw new AppError('PART_NOT_READY', 'The part is still being analyzed');
    const settings = mergeSettings(part, body.settings ?? {});
    const quote = await ctx.db.$transaction(async (tx) => {
      await tx.printPart.update({ where: { id: part.id }, data: { settings } });
      return storeQuote(tx, ctx.env, part, settings, ctx.now(), idempotencyKey ?? undefined);
    });
    return serializeQuote(ctx.env, quote, ctx.now());
  });

  route(app, ctx, printApi.getQuote, async ({ params }, req) => {
    const q = await ctx.db.quote.findUnique({ where: { id: idOr404('quote', params.id, 'Quote') } });
    const mine = q && ((req.auth.userId && q.ownerId === req.auth.userId) || (!q.ownerId && req.auth.anonId && q.anonId === req.auth.anonId));
    if (!q || !mine) throw new AppError('NOT_FOUND', 'Quote not found');
    return serializeQuote(ctx.env, q, ctx.now());
  });

  route(app, ctx, printApi.claimQuote, async ({ params }, req) => {
    const userId = requireUser(req);
    const q = await ctx.db.quote.findUnique({ where: { id: idOr404('quote', params.id, 'Quote') } });
    if (!q) throw new AppError('NOT_FOUND', 'Quote not found');
    if (q.ownerId === userId) return serializeQuote(ctx.env, q, ctx.now());
    if (q.ownerId || !req.auth.anonId || q.anonId !== req.auth.anonId) throw new AppError('NOT_FOUND', 'Quote not found');
    const updated = await ctx.db.$transaction(async (tx) => {
      await tx.printPart.updateMany({ where: { id: q.printPartId, ownerId: null, anonId: req.auth.anonId }, data: { ownerId: userId, expiresAt: null } });
      return tx.quote.update({ where: { id: q.id }, data: { ownerId: userId } });
    });
    return serializeQuote(ctx.env, updated, ctx.now());
  });
}
