import type { FastifyInstance } from 'fastify';
import { AppError, catalogApi, FIT_DISCLAIMER, assertPrintOrderAllowed, toApiId } from '@sw/shared';
import { audit } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404, ownedAsset } from '../lib/access';
import { classify, licenseBlock, licenseFacts, serializeCatalogPart } from '../lib/catalog';
import { mergeSettings, serializeQuote, storeQuote } from '../lib/quote';
import { requireUser, route } from '../lib/route';

export function catalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, catalogApi.listLicenses, async () => ({
    data: (await ctx.db.licenseTerms.findMany({ where: { isCustom: false }, orderBy: { code: 'asc' } })).map((l) => ({
      code: l.code,
      name: l.name,
      text: l.text,
      attribution_template: l.attributionTemplate,
      allows_commercial: l.allowsCommercial,
      allows_derivatives: l.allowsDerivatives,
      allows_print_order: l.allowsPrintOrder,
      personal_print_only: l.personalPrintOnly,
    })),
  }));

  route(app, ctx, catalogApi.setAssetLicense, async ({ params, body }, req) => {
    const userId = requireUser(req);
    const asset = await ownedAsset(ctx.db, req, idOr404(params.id.startsWith('frg_') ? 'forge' : 'asset', params.id, 'Asset'));
    let terms;
    if (body.code === 'CUSTOM') {
      if (!body.custom_text) throw new AppError('VALIDATION_FAILED', 'A custom license needs its text');
      // Custom licenses are conservative: no commercial use, derivatives, or print orders.
      terms = await ctx.db.licenseTerms.create({
        data: { code: `CUSTOM-${asset.id}`, name: 'Custom license', text: body.custom_text, attributionTemplate: '{title} by {author}', allowsCommercial: false, allowsDerivatives: false, allowsPrintOrder: false, isCustom: true, ownerId: userId },
      });
    } else {
      terms = await ctx.db.licenseTerms.findFirst({ where: { code: body.code, isCustom: false } });
      if (!terms) throw new AppError('VALIDATION_FAILED', `Unknown license ${body.code}`);
    }
    const owner = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    const attribution = body.attribution_text ?? '';
    const ml = await ctx.db.modelLicense.upsert({
      where: { assetId: asset.id },
      update: { licenseId: terms.id, attributionText: attribution, sourceUrl: body.source_url ?? null },
      create: { assetId: asset.id, licenseId: terms.id, attributionText: attribution, sourceUrl: body.source_url ?? null },
    });
    await ctx.db.asset.update({ where: { id: asset.id }, data: { license: terms.code } });
    await ctx.db.part.updateMany({ where: { assetId: asset.id }, data: { licenseId: terms.id } });
    await audit(ctx.db, { actorId: userId, action: 'asset.license', targetType: 'asset', targetId: asset.id, data: { code: terms.code }, requestId: req.id });
    return licenseBlock(terms, ml, { title: asset.title, author: owner.name ?? 'a Shapewright creator' });
  });

  route(app, ctx, catalogApi.createPart, async ({ body }, req) => {
    const userId = requireUser(req);
    const asset = await ownedAsset(ctx.db, req, idOr404('asset', body.asset_id, 'Asset'));
    const ml = await ctx.db.modelLicense.findUnique({ where: { assetId: asset.id } });
    const safety = classify(body.safety_class, `${body.title} ${body.category} ${body.description}`);
    const p = await ctx.db.part.create({
      data: {
        ownerId: userId,
        assetId: asset.id,
        title: body.title,
        description: body.description,
        category: body.category,
        partNumberText: body.part_number_text ?? null,
        safetyClass: safety,
        licenseId: ml?.licenseId ?? null,
        printOrderAllowed: body.print_order_allowed && safety !== 'SAFETY_CRITICAL',
        allowedMaterials: body.allowed_materials,
      },
    });
    if (safety !== body.safety_class) {
      await audit(ctx.db, { actorId: null, action: 'part.safety_class.auto', targetType: 'part', targetId: p.id, reason: 'title, category, or description names a safety system', data: { proposed: body.safety_class, set: safety }, requestId: req.id });
    }
    return serializeCatalogPart(ctx.db, p, userId);
  });

  async function readablePart(apiId: string, viewerId: string | null) {
    const p = await ctx.db.part.findUnique({ where: { id: idOr404('catalogPart', apiId, 'Part') } });
    if (!p || (p.status !== 'LIVE' && p.ownerId !== viewerId)) throw new AppError('NOT_FOUND', 'Part not found');
    return p;
  }

  route(app, ctx, catalogApi.getPart, async ({ params }, req) => serializeCatalogPart(ctx.db, await readablePart(params.id, req.auth.userId), req.auth.userId));

  route(app, ctx, catalogApi.partPrintQuote, async ({ params, body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    const p = await readablePart(params.id, userId);
    const l = p.licenseId ? await ctx.db.licenseTerms.findUnique({ where: { id: p.licenseId } }) : null;
    assertPrintOrderAllowed({ safetyClass: p.safetyClass, printOrderAllowed: p.printOrderAllowed, license: licenseFacts(l) });
    if (!body.acknowledge_fit) throw new AppError('FIT_DISCLAIMER_REQUIRED', FIT_DISCLAIMER);
    if (body.settings?.material && !p.allowedMaterials.includes(body.settings.material)) {
      throw new AppError('VALIDATION_FAILED', `This part can be printed in ${p.allowedMaterials.join(' or ')}`);
    }
    const asset = await ctx.db.asset.findUniqueOrThrow({ where: { id: p.assetId! } });
    const v = await ctx.db.assetVersion.findUniqueOrThrow({ where: { id: asset.currentVersionId! }, include: { files: true } });
    const file = v.files.find((f) => f.role === 'STL') ?? v.files.find((f) => f.role === 'PREVIEW_MESH');
    if (!file) throw new AppError('INVALID_STATE', 'This part has no printable mesh');
    const analysis = await ctx.mesh.analyze(await ctx.storage.get(file.storageKey), 'stl');
    const result = await ctx.db.$transaction(async (tx) => {
      const existing = await tx.printPart.findFirst({ where: { ownerId: userId, catalogPartId: p.id, validationReport: { path: ['idempotency_key'], equals: idempotencyKey ?? '' } } });
      const part =
        existing ??
        (await tx.printPart.create({
          data: {
            ownerId: userId,
            title: p.title,
            assetVersionId: v.id,
            sourceFileId: file.id,
            catalogPartId: p.id,
            fitAcknowledgedAt: ctx.now(),
            status: analysis.watertight && analysis.manifold ? 'READY' : 'NEEDS_REPAIR',
            analysis: analysis as object,
            validationReport: { analysis, idempotency_key: idempotencyKey } as object,
            settings: mergeSettings({ settings: { material: p.allowedMaterials[0] ?? 'PETG' } } as never),
          },
        }));
      const settings = mergeSettings(part, body.settings ?? {});
      const quote = await storeQuote(tx, ctx.env, part, settings, ctx.now());
      return { part, quote };
    });
    return { part_id: toApiId('part', result.part.id), quote: serializeQuote(ctx.env, result.quote, ctx.now()) };
  });

  route(app, ctx, catalogApi.adminSafetyClass, async ({ params, body }, req) => {
    const p = await ctx.db.part.findUnique({ where: { id: idOr404('catalogPart', params.id, 'Part') } });
    if (!p) throw new AppError('NOT_FOUND', 'Part not found');
    const updated = await ctx.db.$transaction(async (tx) => {
      const u = await tx.part.update({ where: { id: p.id }, data: { safetyClass: body.safety_class, ...(body.safety_class === 'SAFETY_CRITICAL' ? { printOrderAllowed: false } : {}) } });
      await audit(tx, { actorId: req.auth.userId, action: 'part.safety_class', targetType: 'part', targetId: p.id, reason: body.reason, data: { from: p.safetyClass, to: body.safety_class }, ip: req.ip, requestId: req.id });
      return u;
    });
    return serializeCatalogPart(ctx.db, updated, req.auth.userId);
  });
}
