import type { FastifyInstance } from 'fastify';
import { AppError, libraryApi } from '@sw/shared';
import { createJob } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset, readableAsset } from '../lib/access';
import { decodeCursor, pageOf, requireUser, route } from '../lib/route';
import { serializeAssetSummary, serializeJob, serializeVersion } from '../lib/serialize';

export function libraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const assetIdOf = (apiId: string) => idOr404(apiId.startsWith('frg_') ? 'forge' : 'asset', apiId, 'Asset');

  route(app, ctx, libraryApi.listAssets, async ({ query }, req) => {
    const userId = requireUser(req);
    const before = decodeCursor(query.cursor);
    const rows = await ctx.db.asset.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const versionIds = rows.map((r) => r.currentVersionId).filter((x): x is string => Boolean(x));
    const versions = await ctx.db.assetVersion.findMany({ where: { id: { in: versionIds } }, include: { files: true } });
    const byId = new Map(versions.map((v) => [v.id, v]));
    return pageOf(rows, query.limit, (r) => r.id, (r) => serializeAssetSummary(r, r.currentVersionId ? (byId.get(r.currentVersionId) ?? null) : null));
  });

  route(app, ctx, libraryApi.getAsset, async ({ params }, req) => {
    const { asset, isOwner } = await readableAsset(ctx.db, req, assetIdOf(params.id));
    const versions = await ctx.db.assetVersion.findMany({ where: { assetId: asset.id }, orderBy: { number: 'desc' }, include: { files: true } });
    const current = versions.find((v) => v.id === asset.currentVersionId) ?? versions[0] ?? null;
    return { ...serializeAssetSummary(asset, current), versions: versions.map(serializeVersion), is_owner: isOwner };
  });

  route(app, ctx, libraryApi.repairVersion, async ({ params, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const asset = await ownedAsset(ctx.db, req, assetIdOf(params.id));
    const v = await ctx.db.assetVersion.findUnique({ where: { id: idOr404('version', params.version_id, 'Version') } });
    if (!v || v.assetId !== asset.id) throw new AppError('NOT_FOUND', 'Version not found');
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, { ownerId: userId, kind: 'MESH_ANALYZE', idempotencyKey: idempotencyKey!, input: { op: 'repair' }, reserveCredits: 0, timeoutMs: 10 * 60_000, assetId: asset.id, assetVersionId: v.id }),
    );
    return { job: serializeJob(job) };
  });
}
