import type { FastifyInstance } from 'fastify';
import { AppError, forgeApi } from '@sw/shared';
import { STARTERS, clampMessage, validateParams, type ParamSchema } from '@sw/forge-kit';
import { starterCode } from '@sw/forge-kit/node';
import { createJob } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset, readableAsset } from '../lib/access';
import { FORGE_BUILD_TIMEOUT_MS, FORGE_EXPORT_TIMEOUT_MS, forgeCosts } from '../lib/costs';
import { requireUser, route } from '../lib/route';
import { assertDimensionsConfirmed, printerFor } from '../lib/dimensions';
import { serializeForge, serializeForgeVersion, serializeJob } from '../lib/serialize';

export function forgeRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, forgeApi.listStarters, async () => ({
    data: STARTERS.map((s) => ({ key: s.key, title: s.title, summary: s.summary, example_prompt: s.examplePrompt })),
  }));

  route(app, ctx, forgeApi.getStarter, async ({ params }) => {
    const s = STARTERS.find((x) => x.key === params.key);
    if (!s) throw new AppError('NOT_FOUND', 'Starter not found');
    return { key: s.key, title: s.title, summary: s.summary, example_prompt: s.examplePrompt, code: starterCode(s.key) };
  });

  route(app, ctx, forgeApi.createForge, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    if (body.starter_key && !STARTERS.some((s) => s.key === body.starter_key)) throw new AppError('VALIDATION_FAILED', 'Unknown starter');
    const costs = await forgeCosts(ctx.db);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'FORGE_BUILD',
        idempotencyKey: idempotencyKey!,
        input: { ...(body.prompt ? { prompt: body.prompt } : {}), ...(body.starter_key ? { starter_key: body.starter_key } : {}), profile: body.profile ?? 'fdm-0.4mm-nozzle' },
        // Authoring costs credits; saving a starter is free.
        reserveCredits: body.prompt ? costs.author : 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        maxAttempts: 1,
      }),
    );
    return { job: serializeJob(job) };
  });

  async function loadVersion(assetId: string, versionApiId?: string) {
    const versionId = versionApiId ? idOr404('version', versionApiId, 'Version') : undefined;
    const v = await ctx.db.assetVersion.findFirst({
      where: { assetId, ...(versionId ? { id: versionId } : {}) },
      orderBy: { number: 'desc' },
      include: { forgeSource: true, files: true },
    });
    if (!v?.forgeSource) throw new AppError('NOT_FOUND', 'Version not found');
    return v;
  }

  route(app, ctx, forgeApi.getForge, async ({ params, query }, req) => {
    const { asset, isOwner } = await readableAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    return serializeForge(asset, await loadVersion(asset.id, query.version), isOwner, await printerFor(ctx.db, asset));
  });

  route(app, ctx, forgeApi.saveForgeVersion, async ({ params, body, idempotencyKey }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await loadVersion(asset.id, body.version_id);
    const schema = v.forgeSource!.schema as unknown as ParamSchema;
    const r = validateParams(schema, body.params);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: asset.ownerId,
        kind: 'FORGE_BUILD',
        idempotencyKey: idempotencyKey!,
        input: { base_version_id: v.id, params: r.values, mode: 'version' },
        reserveCredits: 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        assetId: asset.id,
        assetVersionId: v.id,
        maxAttempts: 1,
      }),
    );
    return { job: serializeJob(job), clamped: r.clamped.map((c) => ({ ...c, message: clampMessage(c, schema[c.key]) })) };
  });

  route(app, ctx, forgeApi.forkForge, async ({ params, body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const { asset } = await readableAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await loadVersion(asset.id, body.version_id);
    const schema = v.forgeSource!.schema as unknown as ParamSchema;
    const values = validateParams(schema, body.params ?? ((v.params as Record<string, unknown>) ?? {})).values;
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: userId,
        kind: 'FORGE_BUILD',
        idempotencyKey: idempotencyKey!,
        input: { base_version_id: v.id, params: values, mode: 'fork' },
        reserveCredits: 0,
        timeoutMs: FORGE_BUILD_TIMEOUT_MS,
        maxAttempts: 1,
      }),
    );
    return { job: serializeJob(job) };
  });

  route(app, ctx, forgeApi.listForgeVersions, async ({ params }, req) => {
    const { asset } = await readableAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const versions = await ctx.db.assetVersion.findMany({ where: { assetId: asset.id }, orderBy: { number: 'desc' }, include: { forgeSource: true } });
    return { data: versions.map(serializeForgeVersion) };
  });

  route(app, ctx, forgeApi.patchForgeParams, async ({ params, body }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await loadVersion(asset.id, body.version_id);
    const schema = v.forgeSource!.schema as unknown as ParamSchema;
    const r = validateParams(schema, body.params);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: asset.ownerId,
        kind: 'FORGE_EXPORT',
        idempotencyKey: `params:${v.id}:${JSON.stringify(r.values)}`,
        input: { format: 'stl', params: r.values },
        reserveCredits: 0,
        timeoutMs: FORGE_EXPORT_TIMEOUT_MS,
        assetId: asset.id,
        assetVersionId: v.id,
        maxAttempts: 1,
      }),
    );
    return {
      params: r.values,
      clamped: r.clamped.map((c) => ({ ...c, message: clampMessage(c, schema[c.key]) })),
      unknown: r.unknown,
      job: serializeJob(job),
    };
  });

  route(app, ctx, forgeApi.createForgeExport, async ({ params, body, idempotencyKey }, req) => {
    const asset = await ownedAsset(ctx.db, req, idOr404('forge', params.id, 'Forge'), 'FORGE');
    const v = await loadVersion(asset.id, body.version_id);
    const schema = v.forgeSource!.schema as unknown as ParamSchema;
    const r = validateParams(schema, body.params);
    assertDimensionsConfirmed(v.forgeSource!, validateParams(schema, (v.params as Record<string, unknown>) ?? {}).values, r.values);
    const costs = await forgeCosts(ctx.db);
    const { job } = await ctx.db.$transaction((tx) =>
      createJob(tx, {
        ownerId: asset.ownerId,
        kind: 'FORGE_EXPORT',
        idempotencyKey: idempotencyKey!,
        input: { format: body.format, params: r.values },
        reserveCredits: body.format === 'step' ? costs.step_export : 0,
        timeoutMs: FORGE_EXPORT_TIMEOUT_MS,
        assetId: asset.id,
        assetVersionId: v.id,
        maxAttempts: 2,
      }),
    );
    return { job: serializeJob(job), clamped: r.clamped.map((c) => ({ ...c, message: clampMessage(c, schema[c.key]) })) };
  });
}
