import type { FastifyInstance } from 'fastify';
import { assetsApi, toApiId } from '@sw/shared';
import { audit } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset } from '../lib/access';
import { route } from '../lib/route';

export function assetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const assetIdOf = (apiId: string) => idOr404(apiId.startsWith('frg_') ? 'forge' : 'asset', apiId, 'Asset');

  route(app, ctx, assetsApi.patchAsset, async ({ params, body }, req) => {
    const asset = await ownedAsset(ctx.db, req, assetIdOf(params.id));
    const updated = await ctx.db.asset.update({
      where: { id: asset.id },
      data: { ...(body.title ? { title: body.title } : {}), ...(body.visibility ? { visibility: body.visibility } : {}) },
    });
    if (body.visibility && body.visibility !== asset.visibility) {
      await audit(ctx.db, { actorId: req.auth.userId, action: 'asset.visibility', targetType: 'asset', targetId: asset.id, data: { from: asset.visibility, to: body.visibility }, requestId: req.id });
    }
    return { id: toApiId('asset', updated.id), title: updated.title, visibility: updated.visibility };
  });

  route(app, ctx, assetsApi.deleteAsset, async ({ params }, req) => {
    const asset = await ownedAsset(ctx.db, req, assetIdOf(params.id));
    await ctx.db.asset.update({ where: { id: asset.id }, data: { deletedAt: ctx.now(), visibility: 'PRIVATE' } });
    return { ok: true as const };
  });
}
