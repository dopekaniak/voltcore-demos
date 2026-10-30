import type { FastifyInstance } from 'fastify';
import { AppError, copilotApi } from '@sw/shared';
import { resolveSelection, type FeatureBox } from '@sw/forge-kit';
import type { ForgeFeature } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset, readableAsset } from '../lib/access';
import { route } from '../lib/route';

type Box = { min: [number, number, number]; max: [number, number, number] } | null;

export function serializeFeature(f: ForgeFeature) {
  return { key: f.featureKey, part: f.part, params: f.params, derived: f.derived, bbox_mm: (f.bboxMm as Box) ?? null, code_range: f.codeRange as [number, number] };
}

/** Design copilot (Module 6): named features and region selection. */
export function copilotRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function version(assetId: string, versionApiId?: string) {
    const v = await ctx.db.assetVersion.findFirst({
      where: { assetId, ...(versionApiId ? { id: idOr404('version', versionApiId, 'Version') } : {}) },
      orderBy: { number: 'desc' },
      include: { forgeSource: true, forgeFeatures: { orderBy: { createdAt: 'asc' } } },
    });
    if (!v?.forgeSource) throw new AppError('NOT_FOUND', 'Version not found');
    // Source order: the order the author wrote the features in.
    v.forgeFeatures.sort((a, b) => (a.codeRange as number[])[0]! - (b.codeRange as number[])[0]!);
    return v;
  }

  route(app, ctx, copilotApi.listForgeFeatures, async ({ params, query }, req) => {
    const { asset } = await readableAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await version(asset.id, query.version);
    return { featured: v.forgeFeatures.length > 0, data: v.forgeFeatures.map(serializeFeature) };
  });

  route(app, ctx, copilotApi.createRegionEdit, async ({ params, body }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await version(asset.id, body.version_id);
    if (v.forgeFeatures.length === 0) {
      throw new AppError('FORGE_NOT_FEATURED', 'This forge has no named features, so an area cannot be mapped to one. Describe the change in a text edit instead.');
    }
    const byKey = new Map(v.forgeFeatures.map((f) => [f.featureKey, f]));
    let key: string;
    let share = 1;
    if (body.feature_key) {
      if (!byKey.has(body.feature_key)) throw new AppError('VALIDATION_FAILED', `This forge has no feature "${body.feature_key}"`);
      key = body.feature_key;
    } else {
      const boxes: FeatureBox[] = v.forgeFeatures.map((f) => ({ key: f.featureKey, bbox: (f.bboxMm as Box) ?? null }));
      const r = resolveSelection(boxes, (body.hits ?? []).map((h) => ({ feature: h.feature ?? null, point: h.point })));
      if (r.kind === 'none') throw new AppError('VALIDATION_FAILED', 'The selection does not touch the model. Select an area on the part.');
      if (r.kind === 'ambiguous') {
        throw new AppError('FEATURE_AMBIGUOUS', 'The selection covers more than one feature. Pick the one you mean.', {
          candidates: r.candidates.map((c) => ({ ...serializeFeature(byKey.get(c.key)!), share: c.share })),
        });
      }
      key = r.key;
      share = r.share;
    }
    return { target_feature_key: key, feature: serializeFeature(byKey.get(key)!), share };
  });
}
