import type { FastifyRequest } from 'fastify';
import { AppError, fromApiId, type IdKind } from '@sw/shared';
import type { Asset, Db } from '@sw/db';

/** Parse an API id or 404. Wrong prefixes are indistinguishable from missing rows. */
export function idOr404(kind: IdKind, apiId: string, what = 'Resource'): string {
  const id = fromApiId(kind, apiId);
  if (!id) throw new AppError('NOT_FOUND', `${what} not found`);
  return id;
}

/**
 * Load an asset the caller may read: their own, or a non-private one that is not held by
 * community review. Private assets of
 * other users return 404 (not 403) so their existence does not leak.
 */
export async function readableAsset(db: Db, req: FastifyRequest, assetId: string, kind?: Asset['kind']): Promise<{ asset: Asset; isOwner: boolean }> {
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.deletedAt || (kind && asset.kind !== kind)) throw new AppError('NOT_FOUND', 'Not found');
  const isOwner = req.auth.userId !== null && asset.ownerId === req.auth.userId;
  // Models waiting for review, rejected, or taken down stay hidden from everyone but the owner.
  const held = asset.publishStatus === 'REVIEW' || asset.publishStatus === 'REJECTED' || asset.publishStatus === 'REMOVED';
  if (!isOwner && (asset.visibility === 'PRIVATE' || held)) throw new AppError('NOT_FOUND', 'Not found');
  return { asset, isOwner };
}

export async function ownedAsset(db: Db, req: FastifyRequest, assetId: string, kind?: Asset['kind']): Promise<Asset> {
  const { asset, isOwner } = await readableAsset(db, req, assetId, kind);
  if (!isOwner) throw new AppError('NOT_FOUND', 'Not found');
  return asset;
}
