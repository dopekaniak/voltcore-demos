import { PRICING_CONFIGS } from '@sw/pricing';
import { createDb } from './index';
import { CREDIT_PACKS, FORGE_COSTS, GENERATION_MODELS, LICENSES, MATERIALS, PARTNERS, PLANS } from './seed-data';

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
