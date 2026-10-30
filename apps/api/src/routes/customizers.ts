import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, customizerApi, moderateText, toApiId } from '@sw/shared';
import { validateCustomizerInputs, type InputRule, type ParamSchema } from '@sw/forge-kit';
import { createJob, type Customizer } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { requireUser, route } from '../lib/route';
import { serializeJob } from '../lib/serialize';

interface Policy {
  free_exports_per_month: number;
  export_cost: number;
  free_plan_formats: string[];
  paid_plan_formats: string[];
}

export function customizerRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function load(idOrKey: string): Promise<Customizer> {
    const c = idOrKey.startsWith('cus_')
      ? await ctx.db.customizer.findUnique({ where: { id: idOr404('customizer', idOrKey, 'Customizer') } })
      : await ctx.db.customizer.findUnique({ where: { key: idOrKey } });
    if (!c || c.status !== 'LIVE') throw new AppError('NOT_FOUND', 'Customizer not found');
    return c;
  }
  async function policy(): Promise<Policy> {
    const f = await ctx.db.featureFlag.findUnique({ where: { key: 'customizer.policy' } });
    return (f?.data ?? { free_exports_per_month: 3, export_cost: 5, free_plan_formats: ['stl'], paid_plan_formats: ['stl', '3mf'] }) as unknown as Policy;
  }
  function monthStart(now: Date) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  async function allowance(req: FastifyRequest, c: Customizer) {
    const p = await policy();
    const plan = req.auth.planCode;
    const used = req.auth.userId ? await ctx.db.customizerExport.count({ where: { userId: req.auth.userId, free: true, createdAt: { gte: monthStart(ctx.now()) } } }) : 0;
    return {
      cost: p.export_cost,
      free_remaining: plan === 'free' ? Math.max(0, p.free_exports_per_month - used) : 0,
      formats: plan === 'free' ? p.free_plan_formats : p.paid_plan_formats,
      // Free plans show a small credit line on the export page; printed parts are never marked.
      footer: plan === 'free' ? `Made with the Shapewright ${c.title} customizer` : null,
    };
  }
  async function license(c: Customizer) {
    const l = c.licenseId ? await ctx.db.licenseTerms.findUnique({ where: { id: c.licenseId } }) : null;
    return l ? { code: l.code, name: l.name, attribution: l.attributionTemplate.replace('{title}', c.title).replace('{author}', 'Shapewright') } : null;
  }
  function validate(c: Customizer, inputs: Record<string, unknown>) {
    const v = validateCustomizerInputs(c.schema as unknown as ParamSchema, c.inputRules as Record<string, InputRule>, inputs);
    if (v.invalid.length) throw new AppError('CUSTOMIZER_INPUT_INVALID', v.invalid.map((i) => i.message).join(' '), { invalid: v.invalid });
    for (const [k, val] of Object.entries(v.values)) {
      if (typeof val === 'string' && !moderateText(val).ok) throw new AppError('PROHIBITED_ITEM', 'That text is not allowed.', { key: k });
    }
    return v;
  }

  route(app, ctx, customizerApi.listCustomizers, async () => {
    const rows = await ctx.db.customizer.findMany({ where: { status: 'LIVE' }, orderBy: { createdAt: 'asc' } });
    return { data: await Promise.all(rows.map(async (c) => ({ id: toApiId('customizer', c.id), key: c.key, title: c.title, description: c.description, takes_image: c.imageInput !== null, license: await license(c) }))) };
  });

  route(app, ctx, customizerApi.getCustomizer, async ({ params }, req) => {
    const c = await load(params.id);
    return {
      id: toApiId('customizer', c.id),
      key: c.key,
      title: c.title,
      description: c.description,
      takes_image: c.imageInput !== null,
      license: await license(c),
      code: c.code,
      schema: c.schema as Record<string, unknown>,
      input_rules: c.inputRules as Record<string, unknown>,
      export: await allowance(req, c),
    };
  });

  route(app, ctx, customizerApi.previewCustomizer, async ({ params, body }) => {
    const v = validate(await load(params.id), body.inputs);
    return { values: v.values, clamped: v.clamped };
  });

  async function imageGrid(c: Customizer, userId: string, uploadApiId: string) {
    const rule = c.imageInput as { grid: number } | null;
    if (!rule) throw new AppError('VALIDATION_FAILED', 'This customizer does not take an image');
    const up = await ctx.db.upload.findUnique({ where: { id: idOr404('upload', uploadApiId, 'Upload') } });
    if (!up || up.ownerId !== userId || up.purpose !== 'IMAGE') throw new AppError('NOT_FOUND', 'Upload not found');
    if (up.status !== 'CLEAN') throw new AppError('INVALID_STATE', 'Finish uploading the image first');
    const res = await fetch(`${ctx.env.MESH_URL}/heightmap?grid=${rule.grid}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.env.MESH_SERVICE_TOKEN}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(await ctx.storage.get(up.storageKey)),
    });
    if (res.status === 422) throw new AppError('UPLOAD_REJECTED', ((await res.json()) as { error: { message: string } }).error.message);
    if (!res.ok) throw new AppError('MESH_SERVICE_ERROR', 'The image could not be processed right now');
    return (await res.json()) as { width: number; height: number; data: number[] };
  }

  route(app, ctx, customizerApi.customizerRelief, async ({ params, body }, req) => imageGrid(await load(params.id), requireUser(req), body.upload_id));

  route(app, ctx, customizerApi.exportCustomizer, async ({ params, body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const c = await load(params.id);
    const v = validate(c, body.inputs);
    const a = await allowance(req, c);
    if (!a.formats.includes(body.format)) throw new AppError('PAYMENT_REQUIRED', `${body.format.toUpperCase()} exports need a paid plan`);
    if (body.image_upload_id) await imageGrid(c, userId, body.image_upload_id); // validates ownership and content now
    const free = a.free_remaining > 0;
    const credits = free ? 0 : a.cost;
    const { job } = await ctx.db.$transaction(async (tx) => {
      const r = await createJob(tx, {
        ownerId: userId,
        kind: 'FORGE_EXPORT',
        idempotencyKey: idempotencyKey!,
        input: { format: body.format, params: v.values, customizer_id: c.id, ...(body.image_upload_id ? { relief_upload_id: idOr404('upload', body.image_upload_id) } : {}) },
        reserveCredits: credits,
        timeoutMs: 10 * 60_000,
        maxAttempts: 2,
      });
      if (r.created) await tx.customizerExport.create({ data: { userId, customizerId: c.id, jobId: r.job.id, format: body.format, credits, free, planCode: req.auth.planCode } });
      return r;
    });
    return { job: serializeJob(job), free, credits, footer: a.footer, clamped: v.clamped };
  });

  route(app, ctx, customizerApi.jobFileUrl, async ({ params }, req) => {
    const userId = requireUser(req);
    const job = await ctx.db.job.findUnique({ where: { id: idOr404('job', params.id, 'Job') } });
    const fileId = (job?.output as { file_id?: string } | null)?.file_id;
    if (!job || job.ownerId !== userId || !fileId) throw new AppError('NOT_FOUND', 'File not found');
    const f = await ctx.db.assetFile.findUnique({ where: { id: fileId } });
    if (!f || (f.expiresAt && f.expiresAt <= ctx.now())) throw new AppError('NOT_FOUND', 'File not found or expired');
    return { url: await ctx.storage.signedGetUrl(f.storageKey, { filename: f.filename, contentType: f.contentType, ttlS: 300 }), filename: f.filename, bytes: f.bytes };
  });
}
