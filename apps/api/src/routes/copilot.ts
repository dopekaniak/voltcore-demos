import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { AppError, copilotApi, moderateText, newId, toApiId } from '@sw/shared';
import { calibrate, CalibrationError, measure, mmKeys, resolveSelection, validateParams, type Dimensions, type FeatureBox, type Line, type ParamSchema } from '@sw/forge-kit';
import { createJob, credits, Prisma, type Calibration, type CopilotEdit, type ForgeFeature } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset, readableAsset } from '../lib/access';
import { FORGE_BUILD_TIMEOUT_MS, forgeCosts } from '../lib/costs';
import { requireUser, route } from '../lib/route';
import { serializeJob } from '../lib/serialize';
import { printerFor, serializePrinter } from '../lib/dimensions';

function serializeCalibration(c: Calibration) {
  return {
    id: toApiId('calibration', c.id),
    photo_upload_id: toApiId('upload', c.photoUploadId),
    line_px: c.linePx as Line,
    real_length_mm: c.realLengthMm,
    mm_per_px: c.mmPerPx,
    image: { width: c.imageWidth, height: c.imageHeight },
    source: 'USER_MEASURED' as const,
    created_at: c.createdAt.toISOString(),
  };
}

const calibrated = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CalibrationError) throw new AppError('CALIBRATION_INVALID', e.message);
    throw e;
  }
};

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
    const flag = await ctx.db.featureFlag.findUnique({ where: { key: 'copilot.photo_calibration' } });
    return { featured: v.forgeFeatures.length > 0, edit_cost: (await forgeCosts(ctx.db)).copilot_edit, photo_calibration: Boolean(flag?.enabled), data: v.forgeFeatures.map(serializeFeature) };
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

  // ───────────── Printer profiles ─────────────

  route(app, ctx, copilotApi.listPrinterProfiles, async () => {
    const rows = await ctx.db.printerProfile.findMany({ orderBy: [{ isGeneric: 'desc' }, { name: 'asc' }] });
    return { data: rows.map((p) => serializePrinter(p)) };
  });

  route(app, ctx, copilotApi.setForgePrinterProfile, async ({ params, body }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const p = await ctx.db.printerProfile.findUnique({ where: { id: idOr404('printerProfile', body.profile_id, 'Printer profile') } });
    if (!p) throw new AppError('NOT_FOUND', 'Printer profile not found');
    if (body.bed_mm && !p.isGeneric) throw new AppError('VALIDATION_FAILED', 'Only the generic profile takes a bed size');
    const updated = await ctx.db.asset.update({ where: { id: asset.id }, data: { printerProfileId: p.id, printerBedMm: p.isGeneric && body.bed_mm ? body.bed_mm : Prisma.DbNull } });
    return { printer: await printerFor(ctx.db, updated) };
  });

  // ───────────── Dimensions ─────────────

  route(app, ctx, copilotApi.confirmDimensions, async ({ params, body }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await version(asset.id, body.version_id);
    const dims = { ...((v.forgeSource!.dimensions as unknown as Dimensions | null) ?? {}) };
    for (const [k, d] of Object.entries(dims)) if (d.source === 'assumed' && (!body.keys || body.keys.includes(k))) dims[k] = { ...d, confirmed: true };
    await ctx.db.forgeSource.update({ where: { id: v.forgeSource!.id }, data: { dimensions: dims as unknown as Prisma.InputJsonValue } });
    return { dimensions: Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, { source: d.source, ...(d.confirmed !== undefined ? { confirmed: d.confirmed } : {}) }])) };
  });

  // ───────────── Photo calibration ─────────────

  async function photoCalibrationOn() {
    const f = await ctx.db.featureFlag.findUnique({ where: { key: 'copilot.photo_calibration' } });
    if (!f?.enabled) throw new AppError('FEATURE_DISABLED', 'Photo measurements are not available yet');
  }

  async function ownedCalibration(req: FastifyRequest, apiId: string) {
    const userId = requireUser(req);
    const c = await ctx.db.calibration.findUnique({ where: { id: idOr404('calibration', apiId, 'Calibration') } });
    if (!c || c.ownerId !== userId) throw new AppError('NOT_FOUND', 'Calibration not found');
    return c;
  }

  route(app, ctx, copilotApi.createCalibration, async ({ body }, req, reply) => {
    await photoCalibrationOn();
    const userId = requireUser(req);
    const up = await ctx.db.upload.findUnique({ where: { id: idOr404('upload', body.photo_upload_id, 'Upload') } });
    if (!up || up.ownerId !== userId || up.purpose !== 'IMAGE') throw new AppError('NOT_FOUND', 'Photo not found');
    if (up.status !== 'CLEAN' || !up.imageWidth || !up.imageHeight) throw new AppError('INVALID_STATE', 'Finish uploading the photo first');
    const image = { width: up.imageWidth, height: up.imageHeight };
    const c = calibrated(() => calibrate(image, body.line_px, body.real_length_mm));
    const row = await ctx.db.calibration.create({
      data: { ownerId: userId, photoUploadId: up.id, linePx: body.line_px, realLengthMm: body.real_length_mm, mmPerPx: c.mmPerPx, imageWidth: image.width, imageHeight: image.height },
    });
    reply.status(201);
    return serializeCalibration(row);
  });

  route(app, ctx, copilotApi.getCalibration, async ({ params }, req) => serializeCalibration(await ownedCalibration(req, params.id)));

  route(app, ctx, copilotApi.updateCalibration, async ({ params, body }, req) => {
    const c = await ownedCalibration(req, params.id);
    const image = { width: c.imageWidth, height: c.imageHeight };
    const line = body.line_px ?? (c.linePx as Line);
    const next = calibrated(() => calibrate(image, line, body.real_length_mm));
    return ctx.db.$transaction(async (tx) => {
      const row = await tx.calibration.update({ where: { id: c.id }, data: { realLengthMm: body.real_length_mm, linePx: line, mmPerPx: next.mmPerPx } });
      // Measured dimensions on the owner's latest forge versions follow the new scale and
      // are marked for rebuild with the features that read them.
      const affected: { forge_id: string; version_id: string; key: string; from_mm: number; to_mm: number; needs_rebuild: string[] }[] = [];
      const forges = await tx.asset.findMany({ where: { ownerId: c.ownerId, kind: 'FORGE', deletedAt: null, currentVersionId: { not: null } }, select: { id: true, currentVersionId: true } });
      for (const f of forges) {
        const src = await tx.forgeSource.findUnique({ where: { assetVersionId: f.currentVersionId! }, include: { assetVersion: { include: { forgeFeatures: true } } } });
        const dims = (src?.dimensions as unknown as Dimensions | null) ?? null;
        if (!src || !dims || !Object.values(dims).some((d) => d.calibration_id === c.id)) continue;
        const out = { ...dims };
        for (const [k, d] of Object.entries(dims)) {
          if (d.calibration_id !== c.id || !d.line_px) continue;
          const to = measure(image, d.line_px, next.mmPerPx);
          const from = d.value_mm ?? to;
          const deps = src.assetVersion.forgeFeatures.filter((x) => x.params.includes(k)).map((x) => x.featureKey);
          out[k] = { ...d, value_mm: to, stale: to !== Number((src.assetVersion.params as Record<string, unknown>)[k]), needs_rebuild: deps };
          affected.push({ forge_id: toApiId('forge', f.id), version_id: toApiId('version', f.currentVersionId!), key: k, from_mm: from, to_mm: to, needs_rebuild: deps });
        }
        await tx.forgeSource.update({ where: { id: src.id }, data: { dimensions: out as unknown as Prisma.InputJsonValue } });
      }
      return { calibration: serializeCalibration(row), affected };
    });
  });

  route(app, ctx, copilotApi.createMeasurement, async ({ params, body, idempotencyKey }, req) => {
    await photoCalibrationOn();
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    if (!body.calibration_id) {
      throw new AppError('CALIBRATION_REQUIRED', 'Calibrate the photo first: draw a line across an edge you know and enter its real length. Sizes are never guessed from the picture.');
    }
    const c = await ownedCalibration(req, body.calibration_id);
    const v = await version(asset.id, body.version_id);
    const schema = v.forgeSource!.schema as unknown as ParamSchema;
    if (!mmKeys(schema).includes(body.key)) throw new AppError('VALIDATION_FAILED', `"${body.key}" is not a millimetre size of this forge`);
    const value = calibrated(() => measure({ width: c.imageWidth, height: c.imageHeight }, body.line_px, c.mmPerPx));
    const current = validateParams(schema, (v.params as Record<string, unknown>) ?? {}).values;
    const r = validateParams(schema, { ...current, [body.key]: value });
    if (r.values[body.key] !== value) throw new AppError('VALIDATION_FAILED', `The measured ${value} mm is outside this forge's range for ${schema[body.key]!.label}`);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: asset.ownerId,
        kind: 'FORGE_BUILD',
        idempotencyKey: idempotencyKey!,
        input: {
          base_version_id: v.id,
          params: r.values,
          mode: 'version',
          dimensions_patch: { [body.key]: { source: 'measured', calibration_id: c.id, line_px: body.line_px, value_mm: value } },
        },
        reserveCredits: 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        assetId: asset.id,
        assetVersionId: v.id,
        maxAttempts: 1,
      }),
    );
    return { key: body.key, value_mm: value, source: 'measured' as const, calibration_id: toApiId('calibration', c.id), job: serializeJob(job) };
  });
}
