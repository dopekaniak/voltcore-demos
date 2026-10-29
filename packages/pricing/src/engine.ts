/**
 * Pricing engine (docs/pricing.md). Pure functions over integers: money in minor units,
 * rates as integers, intermediates in BigInt micro-minor units, one round-half-up to minor
 * units at `discounted`. Runs in the browser (live estimates) and on the server (the
 * authoritative price).
 */
import { z } from 'zod';
import { divRoundHalfUp, mulDivRoundHalfUp, toSafeNumber } from '@sw/shared';

export const configSchema = z.object({
  pricing_version: z.number().int().positive(),
  currency: z.literal('USD'),
  materials: z.record(z.string(), z.object({ cost_per_kg_minor: z.number().int().nonnegative(), density_mg_per_cm3: z.number().int().positive(), label: z.string() })),
  colors: z.record(z.string(), z.array(z.string())),
  layer_heights_um: z.array(z.number().int().positive()),
  machine_rate_per_h_minor: z.number().int().nonnegative(),
  finish_cost_minor: z.record(z.string(), z.number().int().nonnegative()),
  margin_bps: z.number().int().nonnegative(),
  min_unit_price_minor: z.number().int().nonnegative(),
  setup_fee_minor: z.number().int().nonnegative(),
  quantity_discounts: z.array(z.object({ min_qty: z.number().int().positive(), bps: z.number().int().min(0).max(10000) })).min(1),
  shipping_minor: z.record(z.string(), z.number().int().nonnegative()),
  shipping_days: z.record(z.string(), z.number().int().nonnegative()),
  tax_mode: z.enum(['none', 'stripe']),
  quote_ttl_minutes: z.number().int().positive(),
  reprice_tolerance_bps: z.number().int().nonnegative(),
  build_volume_mm: z.tuple([z.number(), z.number(), z.number()]),
  scale_pct: z.object({ min: z.number(), max: z.number() }),
  quantity: z.object({ min: z.number().int(), max: z.number().int() }),
  infill_pct: z.object({ min: z.number().int(), max: z.number().int() }),
  lead_time: z.object({ base_days: z.number().int(), per_units: z.number().int().positive() }),
  estimator: z.object({
    shell_mm: z.number(),
    support_density: z.number(),
    line_width_mm: z.number(),
    speed_mm_s: z.number(),
    layer_change_s: z.number(),
    travel_factor: z.number(),
  }),
});
export type PricingConfig = z.infer<typeof configSchema>;

export class PricingError extends Error {
  constructor(
    readonly code: 'PART_TOO_LARGE' | 'SCALE_OUT_OF_RANGE' | 'QUANTITY_OUT_OF_RANGE' | 'MIXED_CURRENCY' | 'VALIDATION_FAILED',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const MICRO = 1_000_000n;

/** Quantity discount in basis points: the highest tier whose min_qty the quantity reaches. */
export function quantityDiscountBps(cfg: PricingConfig, qty: number): number {
  let bps = 0;
  for (const tier of [...cfg.quantity_discounts].sort((a, b) => a.min_qty - b.min_qty)) if (qty >= tier.min_qty) bps = tier.bps;
  return bps;
}

export interface LineInput {
  material: string;
  /** Filament and support mass in milligrams, print time in seconds (integers). */
  filament_mg: number;
  support_mg: number;
  print_time_s: number;
  quantity: number;
  finish?: string;
}

export interface LineResult {
  material: string;
  quantity: number;
  material_mg: number;
  unit_cost_micro: string;
  unit_price_micro: string;
  discount_bps: number;
  unit_price_minor: number;
  setup_fee_minor: number;
  line_total_minor: number;
}

/**
 * material_g = (filament_g + support_g * 0.5) * 1.08
 * unit_cost  = material_g * cost_per_g + print_time_h * machine_rate_per_h + finish_cost
 * unit_price = max(min_unit_price, unit_cost * (1 + margin))
 * discounted = round_half_up(unit_price * (1 - quantity_discount(qty)))
 */
export function priceLine(cfg: PricingConfig, l: LineInput): LineResult {
  const mat = cfg.materials[l.material];
  if (!mat) throw new PricingError('VALIDATION_FAILED', `unknown material ${l.material}`);
  for (const [k, v] of Object.entries({ filament_mg: l.filament_mg, support_mg: l.support_mg, print_time_s: l.print_time_s })) {
    if (!Number.isSafeInteger(v) || v < 0) throw new PricingError('VALIDATION_FAILED', `${k} must be a non-negative integer`);
  }
  checkQuantity(cfg, l.quantity);
  const finish = cfg.finish_cost_minor[l.finish ?? 'standard'];
  if (finish === undefined) throw new PricingError('VALIDATION_FAILED', `unknown finish ${l.finish}`);
  // material in mg ×200 keeps (2f + s) * 108 exact: ((f + s/2) * 1.08) * 200 = (2f + s) * 108
  const materialMgX200 = (2n * BigInt(l.filament_mg) + BigInt(l.support_mg)) * 108n;
  // mg * (minor/kg) = minor * 1e-6 = micro-minor; divide by 200 for the ×200 scale.
  const materialMicro = divRoundHalfUp(materialMgX200 * BigInt(mat.cost_per_kg_minor), 200n);
  const machineMicro = mulDivRoundHalfUp(BigInt(l.print_time_s) * BigInt(cfg.machine_rate_per_h_minor), MICRO, 3600n);
  const unitCost = materialMicro + machineMicro + BigInt(finish) * MICRO;
  const marked = divRoundHalfUp(unitCost * BigInt(10_000 + cfg.margin_bps), 10_000n);
  const minPrice = BigInt(cfg.min_unit_price_minor) * MICRO;
  const unitPrice = marked > minPrice ? marked : minPrice;
  const discount = quantityDiscountBps(cfg, l.quantity);
  const discounted = divRoundHalfUp(unitPrice * BigInt(10_000 - discount), 10_000n * MICRO);
  const unitMinor = toSafeNumber(discounted, 'unit price');
  return {
    material: l.material,
    quantity: l.quantity,
    material_mg: toSafeNumber(divRoundHalfUp(materialMgX200, 200n)),
    unit_cost_micro: unitCost.toString(),
    unit_price_micro: unitPrice.toString(),
    discount_bps: discount,
    unit_price_minor: unitMinor,
    setup_fee_minor: cfg.setup_fee_minor,
    line_total_minor: toSafeNumber(BigInt(unitMinor) * BigInt(l.quantity) + BigInt(cfg.setup_fee_minor), 'line total'),
  };
}

export interface QuoteTotals {
  currency: string;
  lines: LineResult[];
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  promo_minor: number;
  total_minor: number;
  pricing_version: number;
}

/** total = sum(line totals) + shipping + tax - promo */
export function quoteTotals(cfg: PricingConfig, lines: LineInput[], o: { shipping: string; promo_minor?: number; tax_minor?: number; currency?: string }): QuoteTotals {
  if (o.currency && o.currency !== cfg.currency) throw new PricingError('MIXED_CURRENCY', `quote currency ${o.currency} does not match pricing currency ${cfg.currency}`);
  const priced = lines.map((l) => priceLine(cfg, l));
  const shipping = cfg.shipping_minor[o.shipping];
  if (shipping === undefined) throw new PricingError('VALIDATION_FAILED', `unknown shipping method ${o.shipping}`);
  const subtotal = priced.reduce((a, l) => a + BigInt(l.line_total_minor), 0n);
  const tax = BigInt(o.tax_minor ?? 0);
  const promo = BigInt(o.promo_minor ?? 0);
  const total = subtotal + BigInt(shipping) + tax - promo;
  if (total < 0n) throw new PricingError('VALIDATION_FAILED', 'promotion exceeds the total');
  return {
    currency: cfg.currency,
    lines: priced,
    subtotal_minor: toSafeNumber(subtotal),
    shipping_minor: shipping,
    tax_minor: toSafeNumber(tax),
    promo_minor: toSafeNumber(promo),
    total_minor: toSafeNumber(total),
    pricing_version: cfg.pricing_version,
  };
}

export function checkQuantity(cfg: PricingConfig, qty: number): void {
  if (!Number.isInteger(qty) || qty < cfg.quantity.min || qty > cfg.quantity.max) {
    throw new PricingError('QUANTITY_OUT_OF_RANGE', `quantity must be ${cfg.quantity.min}–${cfg.quantity.max}`, { min: cfg.quantity.min, max: cfg.quantity.max });
  }
}

/** Fit the scaled part in the build volume (any axis order); suggest the largest scale that fits. */
export function checkFit(cfg: PricingConfig, bboxMm: [number, number, number], scalePct: number): void {
  if (!(scalePct >= cfg.scale_pct.min && scalePct <= cfg.scale_pct.max)) {
    throw new PricingError('SCALE_OUT_OF_RANGE', `scale must be ${cfg.scale_pct.min}%–${cfg.scale_pct.max}%`, { min: cfg.scale_pct.min, max: cfg.scale_pct.max });
  }
  const dims = bboxMm.map((d) => (d * scalePct) / 100).sort((a, b) => a - b);
  const vol = [...cfg.build_volume_mm].sort((a, b) => a - b);
  if (dims.some((d, i) => d > vol[i]! + 1e-9)) {
    const factor = Math.min(...dims.map((d, i) => vol[i]! / d));
    const suggested = Math.floor(scalePct * factor);
    throw new PricingError('PART_TOO_LARGE', `the part is ${dims.map((d) => d.toFixed(1)).join(' × ')} mm; the build volume is ${vol.join(' × ')} mm`, { suggested_scale_pct: suggested, build_volume_mm: cfg.build_volume_mm });
  }
}

/** True when the new total moved more than the tolerance (default 2%): 409 QUOTE_CHANGED. */
export function quoteChanged(cfg: PricingConfig, oldTotal: number, newTotal: number): boolean {
  const diff = BigInt(Math.abs(newTotal - oldTotal)) * 10_000n;
  return diff > BigInt(oldTotal) * BigInt(cfg.reprice_tolerance_bps);
}

export function leadTimeDays(cfg: PricingConfig, totalUnits: number, shipping: string): number {
  return cfg.lead_time.base_days + Math.floor(totalUnits / cfg.lead_time.per_units) + (cfg.shipping_days[shipping] ?? 0);
}
