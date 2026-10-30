import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { AppError, copilotApi, moderateText, newId, toApiId } from '@sw/shared';
import { resolveSelection, type FeatureBox } from '@sw/forge-kit';
import { createJob, credits, type CopilotEdit, type ForgeFeature } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset, readableAsset } from '../lib/access';
import { FORGE_BUILD_TIMEOUT_MS, forgeCosts } from '../lib/costs';
import { requireUser, route } from '../lib/route';
import { serializeJob } from '../lib/serialize';

/** Proposals hold their credits for a day; the reaper expires undecided ones. */
export const PROPOSAL_TTL_MS = 24 * 3600_000;

export function serializeEdit(e: CopilotEdit, assetId: string) {
  return {
    id: toApiId('copilotEdit', e.id),
    forge_id: toApiId('forge', assetId),
    version_id: toApiId('version', e.assetVersionId),
    message: e.userMessage,
    target_feature_key: e.targetFeatureKey,
    status: e.status,
    credits: e.creditsReserved,
    notes: e.notes,
    diff: (e.diff as never) ?? null,
    preview: (e.preview as never) ?? null,
    error: e.error,
    result_version_id: e.resultVersionId ? toApiId('version', e.resultVersionId) : null,
    created_at: e.createdAt.toISOString(),
  };
}

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
    return { featured: v.forgeFeatures.length > 0, edit_cost: (await forgeCosts(ctx.db)).copilot_edit, data: v.forgeFeatures.map(serializeFeature) };
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
    const edit = body.message ? await propose(req, asset.id, v.id, body.message, key, `region:${asset.id}:${v.id}:${key}:${body.message}:${newId()}`) : null;
    return { target_feature_key: key, feature: serializeFeature(byKey.get(key)!), share, edit: edit?.edit ?? null, job: edit?.job ?? null };
  });

  /**
   * Create a proposal: moderate the message, hold the edit's credits, and queue the
   * author + sandbox build. Credits are charged on accept and released on reject.
   */
  async function propose(req: FastifyRequest, assetId: string, versionId: string, message: string, targetKey: string | null, idempotencyKey: string) {
    const userId = requireUser(req);
    const m = moderateText(message);
    if (!m.ok) throw new AppError('PROHIBITED_ITEM', 'This change describes an item we do not make or print.', { term: m.term });
    const cost = (await forgeCosts(ctx.db)).copilot_edit;
    return ctx.db.$transaction(async (tx) => {
      const editId = newId();
      const r = await createJob(tx, {
        ownerId: userId,
        kind: 'FORGE_BUILD',
        idempotencyKey,
        input: { copilot_edit_id: editId },
        reserveCredits: 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        assetId,
        assetVersionId: versionId,
        maxAttempts: 1,
      });
      if (!r.created) {
        const existing = await tx.copilotEdit.findFirst({ where: { jobId: r.job.id } });
        if (!existing) throw new AppError('CONFLICT', 'Idempotency key reused for a different request');
        return { edit: serializeEdit(existing, assetId), job: serializeJob(r.job) };
      }
      const res = cost > 0 ? await credits.reserve(tx, { ownerId: userId, amount: cost, expiresAt: new Date(ctx.now().getTime() + PROPOSAL_TTL_MS), idempotencyKey: `copilot-reserve:${editId}` }) : null;
      const edit = await tx.copilotEdit.create({
        data: { id: editId, ownerId: userId, assetVersionId: versionId, userMessage: message, targetFeatureKey: targetKey, creditsReserved: cost, reservationId: res?.reservationId ?? null, jobId: r.job.id },
      });
      return { edit: serializeEdit(edit, assetId), job: serializeJob(r.job) };
    });
  }

  async function ownedEdit(req: FastifyRequest, apiId: string) {
    const userId = requireUser(req);
    const e = await ctx.db.copilotEdit.findUnique({ where: { id: idOr404('copilotEdit', apiId, 'Edit') }, include: { assetVersion: true } });
    if (!e || e.ownerId !== userId) throw new AppError('NOT_FOUND', 'Edit not found');
    return e;
  }

  route(app, ctx, copilotApi.createCopilotEdit, async ({ params, body, idempotencyKey }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await version(asset.id, body.version_id);
    if (body.target_feature_key && !v.forgeFeatures.some((f) => f.featureKey === body.target_feature_key)) {
      throw v.forgeFeatures.length ? new AppError('VALIDATION_FAILED', `This forge has no feature "${body.target_feature_key}"`) : new AppError('FORGE_NOT_FEATURED', 'This forge has no named features; describe the change without selecting one.');
    }
    return propose(req, asset.id, v.id, body.message, body.target_feature_key ?? null, idempotencyKey!);
  });

  route(app, ctx, copilotApi.listCopilotEdits, async ({ params }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const rows = await ctx.db.copilotEdit.findMany({ where: { assetVersion: { assetId: asset.id } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { data: rows.map((e) => serializeEdit(e, asset.id)) };
  });

  route(app, ctx, copilotApi.getCopilotEdit, async ({ params }, req) => {
    const e = await ownedEdit(req, params.id);
    return serializeEdit(e, e.assetVersion.assetId);
  });

  route(app, ctx, copilotApi.acceptCopilotEdit, async ({ params, idempotencyKey }, req) => {
    const e = await ownedEdit(req, params.id);
    return ctx.db.$transaction(async (tx) => {
      const r = await createJob(tx, {
        ownerId: e.ownerId,
        kind: 'FORGE_BUILD',
        idempotencyKey: idempotencyKey!,
        input: { base_version_id: e.assetVersionId, mode: 'version', accept_edit_id: e.id },
        reserveCredits: 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        assetId: e.assetVersion.assetId,
        assetVersionId: e.assetVersionId,
        maxAttempts: 1,
      });
      if (r.created) {
        // Only a PROPOSED edit can be accepted; the conditional update makes it race-safe.
        const moved = await tx.copilotEdit.updateMany({ where: { id: e.id, status: 'PROPOSED' }, data: { status: 'ACCEPTED', acceptJobId: r.job.id, decidedAt: ctx.now() } });
        if (moved.count !== 1) throw new AppError('INVALID_STATE', `This edit is ${e.status.toLowerCase()} and cannot be accepted`);
        // The held credits are charged when the new version is saved (worker), in that transaction.
      }
      const fresh = await tx.copilotEdit.findUniqueOrThrow({ where: { id: e.id } });
      return { edit: serializeEdit(fresh, e.assetVersion.assetId), job: serializeJob(r.job) };
    });
  });

  route(app, ctx, copilotApi.rejectCopilotEdit, async ({ params }, req) => {
    const e = await ownedEdit(req, params.id);
    if (e.status === 'REJECTED') return { edit: serializeEdit(e, e.assetVersion.assetId) };
    return ctx.db.$transaction(async (tx) => {
      const moved = await tx.copilotEdit.updateMany({ where: { id: e.id, status: { in: ['PROPOSED', 'PROPOSING'] } }, data: { status: 'REJECTED', decidedAt: ctx.now() } });
      if (moved.count !== 1) throw new AppError('INVALID_STATE', `This edit is ${e.status.toLowerCase()} and cannot be rejected`);
      if (e.reservationId) await credits.release(tx, { reservationId: e.reservationId, idempotencyKey: `copilot-release:${e.id}` });
      const fresh = await tx.copilotEdit.findUniqueOrThrow({ where: { id: e.id } });
      return { edit: serializeEdit(fresh, e.assetVersion.assetId) };
    });
  });
}
