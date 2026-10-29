import { AppError, toApiId } from '@sw/shared';
import { sha256Hex } from '@sw/shared/node';
import { checkFit, estimatePrint, leadTimeDays, PricingError, pricingConfig, quoteTotals, settingsSchema, validateSettings, type MeshFacts, type PrintSettings } from '@sw/pricing';
import type { Env } from '@sw/config';
import type { PrintPart, Quote, Tx } from '@sw/db';

export const TAX_NOTE = 'Tax calculated where applicable.';

/** The analysis of the mesh that would be printed (the repaired one when chosen). */
export function currentFacts(part: PrintPart): (MeshFacts & { printable?: boolean }) | null {
  const repair = part.repairReport as { after?: MeshFacts } | null;
  const a = (part.useRepaired && repair?.after ? repair.after : part.analysis) as (MeshFacts & { printable?: boolean }) | null;
  return a && typeof a.volume_mm3 === 'number' ? a : null;
}

export function mergeSettings(part: PrintPart, patch: Record<string, unknown> = {}): PrintSettings {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return settingsSchema.parse({ ...((part.settings as object) ?? {}), ...clean });
}

function toAppError(e: unknown): never {
  if (e instanceof PricingError) throw new AppError(e.code, e.message, e.details);
  throw e;
}

/**
 * Compute the authoritative price for a part. Clients never send amounts; anything they
 * send besides settings is ignored by the schema.
 */
export function priceFor(env: Env, part: PrintPart, settings: PrintSettings) {
  const cfg = pricingConfig();
  const problems = validateSettings(cfg, settings);
  if (problems.length) throw new AppError('VALIDATION_FAILED', problems.join('; '), { problems });
  const facts = currentFacts(part);
  if (!facts) throw new AppError('PART_NOT_READY', 'The part is still being analyzed');
  try {
    checkFit(cfg, facts.bbox_mm, settings.scale_pct);
    const est = estimatePrint(cfg, facts, settings);
    const totals = quoteTotals(cfg, [{ material: settings.material, filament_mg: est.filament_mg, support_mg: est.support_mg, print_time_s: est.print_time_s, quantity: settings.quantity }], { shipping: settings.shipping, tax_minor: 0 });
    const isEstimate = env.SLICER_MODE === 'estimate';
    return {
      cfg,
      est,
      totals,
      isEstimate,
      orderable: !isEstimate || env.ESTIMATE_ORDERS === 'allow-dev',
      leadTime: leadTimeDays(cfg, settings.quantity, settings.shipping),
      inputsHash: sha256Hex(JSON.stringify({ facts: { v: facts.volume_mm3, a: facts.surface_area_mm2, b: facts.bbox_mm, o: facts.overhang_area_mm2 }, settings, version: cfg.pricing_version })),
    };
  } catch (e) {
    toAppError(e);
  }
}

export async function storeQuote(tx: Tx, env: Env, part: PrintPart, settings: PrintSettings, now: Date, idempotencyKey?: string): Promise<Quote> {
  const p = priceFor(env, part, settings);
  const line = p.totals.lines[0]!;
  // Older active quotes for the part are superseded.
  await tx.quote.updateMany({ where: { printPartId: part.id, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
  return tx.quote.create({
    data: {
      ownerId: part.ownerId,
      anonId: part.ownerId ? null : part.anonId,
      printPartId: part.id,
      inputsHash: p.inputsHash,
      inputs: { settings, estimate: { ...p.est } } as object,
      lines: [
        {
          part_id: part.id,
          material: settings.material,
          quantity: settings.quantity,
          unit_price_minor: line.unit_price_minor,
          setup_fee_minor: line.setup_fee_minor,
          line_total_minor: line.line_total_minor,
          discount_bps: line.discount_bps,
          filament_g: Math.round(p.est.filament_mg / 100) / 10,
          support_g: Math.round(p.est.support_mg / 100) / 10,
          print_time_h: Math.round((p.est.print_time_s / 3600) * 100) / 100,
        },
      ],
      subtotalMinor: p.totals.subtotal_minor,
      shippingMinor: p.totals.shipping_minor,
      taxMinor: p.totals.tax_minor,
      totalMinor: p.totals.total_minor,
      currency: p.totals.currency,
      pricingVersion: p.totals.pricing_version,
      isEstimate: p.isEstimate,
      leadTimeDays: p.leadTime,
      idempotencyKey: idempotencyKey ?? null,
      expiresAt: new Date(now.getTime() + p.cfg.quote_ttl_minutes * 60_000),
    },
  });
}

export function serializeQuote(env: Env, q: Quote, now = new Date()) {
  const expired = q.status === 'ACTIVE' && q.expiresAt <= now;
  const lines = (q.lines as { part_id: string; [k: string]: unknown }[]).map((l) => ({ ...l, part_id: toApiId('part', l.part_id) }));
  return {
    id: toApiId('quote', q.id),
    part_id: toApiId('part', q.printPartId),
    status: expired ? ('EXPIRED' as const) : q.status,
    is_estimate: q.isEstimate,
    orderable: !q.isEstimate || env.ESTIMATE_ORDERS === 'allow-dev',
    currency: q.currency,
    lines: lines as never,
    subtotal_minor: q.subtotalMinor,
    shipping_minor: q.shippingMinor,
    tax_minor: q.taxMinor,
    total_minor: q.totalMinor,
    tax_note: TAX_NOTE,
    pricing_version: q.pricingVersion,
    lead_time_days: q.leadTimeDays,
    settings: (q.inputs as { settings: Record<string, unknown> }).settings,
    expires_at: q.expiresAt.toISOString(),
    created_at: q.createdAt.toISOString(),
  };
}
