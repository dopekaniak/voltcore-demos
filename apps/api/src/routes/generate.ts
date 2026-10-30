import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, generateApi } from '@sw/shared';
import { moderateOrRefuse } from '../lib/moderation';
import { createJob, type GenerationModel } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset } from '../lib/access';
import { requireUser, route } from '../lib/route';
import { serializeJob } from '../lib/serialize';

export const GENERATION_TIMEOUT_MS = 30 * 60_000;

export function generateRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Models the current mode can actually run. */
  async function availableModels(): Promise<GenerationModel[]> {
    const rows = await ctx.db.generationModel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    return rows.filter((m) => ctx.providers.has(m.providerKey) && (ctx.env.PROVIDER_MODE === 'live' || m.providerKey === 'mock'));
  }
  async function modelFor(code?: string): Promise<GenerationModel> {
    const models = await availableModels();
    const m = code ? models.find((x) => x.code === code) : models[0];
    if (!m) throw new AppError('VALIDATION_FAILED', code ? `Model ${code} is not available` : 'No generation model is available');
    return m;
  }
  const costOf = (m: GenerationModel, kind: string) => {
    const c = (m.costs as Record<string, number>)[kind];
    if (typeof c !== 'number') throw new AppError('VALIDATION_FAILED', `${m.name} does not support ${kind}`);
    return c;
  };
  const can = (m: GenerationModel, cap: string) => Boolean((m.capabilities as Record<string, unknown>)[cap]);
  const moderate = (text: string, req: FastifyRequest) => moderateOrRefuse(ctx, req, text, 'generate');

  route(app, ctx, generateApi.listModels, async () => ({
    data: (await availableModels()).map((m) => ({ code: m.code, name: m.name, provider: m.providerKey, capabilities: m.capabilities as Record<string, unknown>, costs: m.costs as Record<string, number> })),
  }));

  route(app, ctx, generateApi.getEstimate, async ({ query }) => {
    const m = await modelFor(query.model);
    return { kind: query.kind, model: m.code, credits: costOf(m, query.kind) };
  });

  route(app, ctx, generateApi.textTo3d, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    if (body.mode === 'preview') {
      await moderate(body.prompt, req);
      const m = await modelFor(body.model);
      if (!can(m, 'textTo3D')) throw new AppError('VALIDATION_FAILED', `${m.name} cannot do text to 3D`);
      const { job } = await ctx.db.$transaction((tx) =>
        createJob(tx, {
          ownerId: userId,
          kind: 'GENERATE',
          idempotencyKey: idempotencyKey!,
          input: { op: 'preview', prompt: body.prompt, ...(body.style ? { style: body.style } : {}), ...(body.topology ? { topology: body.topology } : {}), ...(body.polycount ? { polycount: body.polycount } : {}) },
          reserveCredits: costOf(m, 'preview'),
          timeoutMs: GENERATION_TIMEOUT_MS,
          providerKey: m.providerKey,
          modelCode: m.code,
        }),
      );
      return { job: serializeJob(job) };
    }
    const preview = await ctx.db.job.findUnique({ where: { id: idOr404('job', body.preview_job_id, 'Preview') } });
    if (!preview || preview.ownerId !== userId || preview.kind !== 'GENERATE') throw new AppError('NOT_FOUND', 'Preview not found');
    if (preview.status !== 'SUCCEEDED' || !preview.assetVersionId) throw new AppError('PREVIEW_NOT_READY', 'Refine is available once the preview has succeeded');
    if (body.texture_prompt) await moderate(body.texture_prompt, req);
    const m = await modelFor(preview.modelCode ?? undefined);
    if (!can(m, 'refine')) throw new AppError('VALIDATION_FAILED', `${m.name} cannot refine`);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'REFINE',
        idempotencyKey: idempotencyKey!,
        input: { op: 'refine', ...(body.texture_prompt ? { texture_prompt: body.texture_prompt } : {}) },
        reserveCredits: costOf(m, 'refine'),
        timeoutMs: GENERATION_TIMEOUT_MS,
        parentJobId: preview.id,
        assetId: preview.assetId,
        assetVersionId: preview.assetVersionId,
        providerKey: m.providerKey,
        modelCode: m.code,
      }),
    );
    return { job: serializeJob(job) };
  });

  route(app, ctx, generateApi.imageTo3d, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const ids = body.upload_ids.map((u) => idOr404('upload', u, 'Upload'));
    const uploads = await ctx.db.upload.findMany({ where: { id: { in: ids }, ownerId: userId } });
    if (uploads.length !== ids.length || uploads.some((u) => u.purpose !== 'IMAGE')) throw new AppError('NOT_FOUND', 'Upload not found');
    if (uploads.some((u) => u.status !== 'CLEAN')) throw new AppError('INVALID_STATE', 'Finish uploading the images first');
    if (body.title) await moderate(body.title, req);
    const m = await modelFor(body.model);
    if (!can(m, 'imageTo3D')) throw new AppError('VALIDATION_FAILED', `${m.name} cannot do image to 3D`);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'GENERATE',
        idempotencyKey: idempotencyKey!,
        input: { op: 'image', upload_ids: ids, remove_background: body.remove_background, ...(body.title ? { title: body.title } : {}) },
        reserveCredits: costOf(m, 'image'),
        timeoutMs: GENERATION_TIMEOUT_MS,
        providerKey: m.providerKey,
        modelCode: m.code,
      }),
    );
    return { job: serializeJob(job) };
  });

  async function ownedVersion(req: Parameters<typeof requireUser>[0], apiVersionId: string) {
    const v = await ctx.db.assetVersion.findUnique({ where: { id: idOr404('version', apiVersionId, 'Version') } });
    if (!v) throw new AppError('NOT_FOUND', 'Version not found');
    const asset = await ownedAsset(ctx.db, req, v.assetId);
    return { v, asset };
  }

  route(app, ctx, generateApi.retexture, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    await moderate(body.prompt, req);
    const { v, asset } = await ownedVersion(req, body.asset_version_id);
    const m = await modelFor(body.model);
    if (!can(m, 'retexture')) throw new AppError('VALIDATION_FAILED', `${m.name} cannot retexture`);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'RETEXTURE',
        idempotencyKey: idempotencyKey!,
        input: { op: 'retexture', prompt: body.prompt },
        reserveCredits: costOf(m, 'retexture'),
        timeoutMs: GENERATION_TIMEOUT_MS,
        assetId: asset.id,
        assetVersionId: v.id,
        providerKey: m.providerKey,
        modelCode: m.code,
      }),
    );
    return { job: serializeJob(job) };
  });

  route(app, ctx, generateApi.remesh, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const { v, asset } = await ownedVersion(req, body.asset_version_id);
    const m = await modelFor();
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'REMESH',
        idempotencyKey: idempotencyKey!,
        input: { op: 'remesh', target_faces: body.target_faces },
        reserveCredits: costOf(m, 'remesh'),
        timeoutMs: 10 * 60_000,
        assetId: asset.id,
        assetVersionId: v.id,
      }),
    );
    return { job: serializeJob(job) };
  });
}
