import { PRICING_CONFIGS } from '@sw/pricing';
import { createDb } from './index';
import { readFileSync } from 'node:fs';
import { CUSTOMIZERS } from '@sw/forge-kit/customizers';
import { extractSchema, PRINTER_PROFILES } from '@sw/forge-kit';
import { CREDIT_PACKS, CUSTOMIZER_POLICY, FORGE_COSTS, GENERATION_MODELS, LICENSES, MATERIALS, PARTNERS, PLANS } from './seed-data';

/** Idempotent seed: safe to run repeatedly. */
export async function seed(url?: string): Promise<void> {
  const db = createDb(url);
  try {
    for (const p of PLANS) await db.plan.upsert({ where: { code: p.code }, update: { ...p }, create: { ...p } });
    for (const p of CREDIT_PACKS)
      await db.creditPack.upsert({ where: { code: p.code }, update: { ...p }, create: { ...p } });
    for (const m of MATERIALS)
      await db.material.upsert({ where: { code: m.code }, update: { ...m, colors: [...m.colors] }, create: { ...m, colors: [...m.colors] } });
    for (const partner of PARTNERS) {
      const { printers, ...data } = partner;
      const row = await db.printPartner.upsert({ where: { code: data.code }, update: data, create: data });
      for (const pr of printers) {
        const existing = await db.partnerPrinter.findFirst({ where: { partnerId: row.id, name: pr.name } });
        const values = { materials: [...pr.materials], bedMm: [...pr.bedMm], queueMinutes: pr.queueMinutes };
        if (existing) await db.partnerPrinter.update({ where: { id: existing.id }, data: values });
        else await db.partnerPrinter.create({ data: { partnerId: row.id, name: pr.name, ...values } });
      }
    }
    for (const [version, config] of Object.entries(PRICING_CONFIGS)) {
      await db.pricingConfig.upsert({
        where: { version: Number(version) },
        update: {},
        create: { version: Number(version), config: config as object },
      });
    }
    for (const m of GENERATION_MODELS) {
      const data = { ...m, capabilities: m.capabilities as object, costs: m.costs as object };
      await db.generationModel.upsert({ where: { code: m.code }, update: data, create: data });
    }
    for (const l of LICENSES) await db.licenseTerms.upsert({ where: { code: l.code }, update: { ...l }, create: { ...l } });
    await db.featureFlag.upsert({ where: { key: 'customizer.policy' }, update: { data: CUSTOMIZER_POLICY, enabled: true }, create: { key: 'customizer.policy', enabled: true, data: CUSTOMIZER_POLICY } });
    const mit = await db.licenseTerms.findUniqueOrThrow({ where: { code: 'CC-BY-4.0' } });
    for (const c of CUSTOMIZERS) {
      const url = new URL(`../../forge-kit/customizers/${c.key}.js`, import.meta.url);
      const code = readFileSync(url, 'utf8');
      // Our own starter files (trusted): read their parameter schema directly.
      const part = (await import(url.href)).default as { parameters: unknown; defaults: Record<string, unknown> };
      const data = {
        title: c.title,
        description: c.summary,
        templateKey: c.key,
        code,
        schema: extractSchema(part.parameters, part.defaults) as object,
        inputRules: c.inputs as object,
        imageInput: (c.image ?? null) as object,
        pricePolicy: CUSTOMIZER_POLICY as object,
        printDefaults: { material: 'PLA', color: 'black' },
        status: 'LIVE' as const,
        licenseId: mit.id,
      };
      await db.customizer.upsert({ where: { key: c.key }, update: data, create: { key: c.key, ...data } });
    }
    for (const p of PRINTER_PROFILES) {
      const data = {
        name: p.name,
        bedMm: p.bed_mm,
        nozzleMm: p.nozzle_mm,
        validatedMaterials: p.validated_materials,
        overhangDefaultDeg: p.overhang_default_deg,
        wallMinMm: p.wall_min_mm,
        sourceUrl: p.source_url,
        retrievedOn: p.retrieved_on ? new Date(`${p.retrieved_on}T00:00:00Z`) : null,
        isGeneric: p.is_generic,
      };
      await db.printerProfile.upsert({ where: { key: p.key }, update: data, create: { key: p.key, ...data } });
    }
    // Photo calibration is open now that the image content policy is enforced (M6-F).
    await db.featureFlag.upsert({ where: { key: 'copilot.photo_calibration' }, update: { enabled: true }, create: { key: 'copilot.photo_calibration', enabled: true, data: {} } });
    await db.featureFlag.upsert({
      where: { key: 'forge.costs' },
      update: { data: FORGE_COSTS, enabled: true },
      create: { key: 'forge.costs', enabled: true, data: FORGE_COSTS },
    });
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => console.log('seed complete'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
