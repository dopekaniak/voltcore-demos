import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/reference-parts.json' with { type: 'json' };
import { checkFit, checkQuantity, estimatePrint, leadTimeDays, PricingError, priceLine, pricingConfig, quantityDiscountBps, quoteChanged, quoteTotals, settingsSchema, validateSettings } from '../src/index';

const cfg = pricingConfig(1);
const line = (o: Partial<Parameters<typeof priceLine>[1]> = {}) => priceLine(cfg, { material: 'PLA', filament_mg: 12000, support_mg: 0, print_time_s: 5400, quantity: 1, ...o });

describe('golden fixtures (10 reference parts)', () => {
  it('has ten parts', () => expect(fixtures.parts).toHaveLength(10));
  it.each(fixtures.parts.map((p) => [p.name, p] as const))('%s', (_n, p) => {
    const q = quoteTotals(cfg, [p.input], { shipping: p.shipping });
    expect({ unit_price_minor: q.lines[0]!.unit_price_minor, line_total_minor: q.lines[0]!.line_total_minor, total_minor: q.total_minor }).toEqual(p.expect);
  });
});

describe('quantity discount tiers', () => {
  it.each([
    [1, 0], [2, 0], [9, 0], [10, 500], [11, 500], [49, 500], [50, 1000], [99, 1000], [100, 1500], [249, 1500], [250, 2000], [499, 2000], [500, 2000],
  ])('qty %i → %i bps', (q, bps) => expect(quantityDiscountBps(cfg, q)).toBe(bps));
});

describe('line pricing table', () => {
  it.each([
    // [material, filament_mg, support_mg, seconds, qty, expected unit minor]
    ['PLA', 12000, 0, 5400, 1, 772],
    ['PLA', 12000, 4000, 5400, 1, 780], // supports count half: (12 + 2) × 1.08 g
    ['PLA', 0, 0, 0, 1, 500], // minimum unit price
    ['PLA', 0, 0, 0, 10, 475], // minimum then discount
    ['PETG', 40000, 6000, 14400, 1, 2143],
    ['PETG', 40000, 6000, 14400, 12, 2036],
    ['ASA', 2000, 0, 900, 1, 500],
    ['ASA', 2000, 0, 900, 100, 425],
    ['PLA', 1000000, 0, 0, 1, 4320], // 1 kg PLA: 1080 g × 2.5 ¢ × 1.6
    ['PLA', 0, 0, 3600, 1, 500], // 1 h machine = 300 ¢ × 1.6 = 480 → min 500
    ['PLA', 0, 0, 7200, 1, 960],
    ['PETG', 0, 0, 36000, 1, 4800],
    ['ASA', 100000, 0, 0, 1, 657], // 108 g × 3.8 ¢ × 1.6 = 656.64 → 657
    ['ASA', 100000, 0, 0, 50, 591], // 656.64 × 0.9 = 590.976 → 591
    ['PLA', 12000, 0, 5400, 250, 617], // 771.84 × 0.8 = 617.472
  ] as const)('%s %i mg + %i mg support, %i s, ×%i → %i ¢', (material, f, s, t, q, expected) => {
    expect(priceLine(cfg, { material, filament_mg: f, support_mg: s, print_time_s: t, quantity: q }).unit_price_minor).toBe(expected);
  });

  it('rounds half up at the discounted step only', () => {
    // unit price exactly x.5 after discount: 1000 ¢ unit × 0.95 = 950 (exact) — and a half case
    const r = line({ filament_mg: 0, print_time_s: 3600 * 2 + 1, quantity: 1 });
    expect(Number.isInteger(r.unit_price_minor)).toBe(true);
  });

  it('adds the setup fee once per line', () => {
    expect(line({ quantity: 3 }).line_total_minor).toBe(772 * 3 + 300);
  });

  it.each([
    [{ filament_mg: -1 }, 'VALIDATION_FAILED'],
    [{ filament_mg: 1.5 }, 'VALIDATION_FAILED'],
    [{ print_time_s: Number.NaN }, 'VALIDATION_FAILED'],
    [{ material: 'NYLON' }, 'VALIDATION_FAILED'],
    [{ quantity: 0 }, 'QUANTITY_OUT_OF_RANGE'],
    [{ quantity: 501 }, 'QUANTITY_OUT_OF_RANGE'],
    [{ quantity: 2.5 }, 'QUANTITY_OUT_OF_RANGE'],
    [{ finish: 'chrome' }, 'VALIDATION_FAILED'],
  ] as const)('rejects %o with %s', (o, code) => {
    expect(() => line(o as never)).toThrow(expect.objectContaining({ code }));
  });
});

describe('quote totals', () => {
  it('sums lines, shipping, tax, and promo', () => {
    const q = quoteTotals(cfg, [fixtures.parts[0]!.input, fixtures.parts[1]!.input], { shipping: 'express', tax_minor: 100, promo_minor: 50 });
    expect(q.subtotal_minor).toBe(1072 + 24732);
    expect(q.total_minor).toBe(1072 + 24732 + 1499 + 100 - 50);
    expect(q.pricing_version).toBe(1);
  });
  it('rejects mixed currency', () => {
    expect(() => quoteTotals(cfg, [fixtures.parts[0]!.input], { shipping: 'standard', currency: 'EUR' })).toThrow(expect.objectContaining({ code: 'MIXED_CURRENCY' }));
  });
  it('rejects unknown shipping and promos larger than the total', () => {
    expect(() => quoteTotals(cfg, [fixtures.parts[0]!.input], { shipping: 'drone' })).toThrow(PricingError);
    expect(() => quoteTotals(cfg, [fixtures.parts[0]!.input], { shipping: 'standard', promo_minor: 10_000 })).toThrow(/promotion/);
  });
});

describe('build volume and scale', () => {
  it('accepts parts that fit in any orientation', () => {
    expect(() => checkFit(cfg, [250, 10, 10], 100)).not.toThrow();
    expect(() => checkFit(cfg, [10, 255, 250], 100)).not.toThrow();
  });
  it('rejects a part too big for the build volume with a suggested scale', () => {
    try {
      checkFit(cfg, [300, 20, 20], 100);
      expect.unreachable();
    } catch (e) {
      expect((e as PricingError).code).toBe('PART_TOO_LARGE');
      expect((e as PricingError).details.suggested_scale_pct).toBe(85);
    }
  });
  it.each([[0.5], [0], [1001], [Number.NaN]])('rejects scale %s%%', (s) => {
    expect(() => checkFit(cfg, [10, 10, 10], s)).toThrow(expect.objectContaining({ code: 'SCALE_OUT_OF_RANGE' }));
  });
  it.each([[1], [100], [1000]])('accepts scale %s%%', (s) => {
    expect(() => checkFit(cfg, [10, 10, 10], s)).not.toThrow();
  });
  it.each([[1, true], [500, true], [0, false], [501, false]])('quantity %i ok=%s', (q, ok) => {
    if (ok) expect(() => checkQuantity(cfg, q)).not.toThrow();
    else expect(() => checkQuantity(cfg, q)).toThrow();
  });
});

describe('reprice tolerance (409 QUOTE_CHANGED beyond 2%)', () => {
  it.each([
    [10000, 10000, false], [10000, 10200, false], [10000, 10201, true], [10000, 9800, false], [10000, 9799, true], [1671, 1705, true], [1671, 1704, false],
  ])('%i → %i changed=%s', (a, b, changed) => expect(quoteChanged(cfg, a, b)).toBe(changed));
});

describe('estimator', () => {
  const cube = { volume_mm3: 8000, surface_area_mm2: 2400, bbox_mm: [20, 20, 20] as [number, number, number], overhang_area_mm2: 0 };
  const s = (o: object = {}) => settingsSchema.parse(o);
  it('is deterministic', () => expect(estimatePrint(cfg, cube, s())).toEqual(estimatePrint(cfg, cube, s())));
  it('matches the reference 20 mm cube at defaults', () => {
    // shell = min(8000, 2400 * 0.8 = 1920); infill = 6080 * 0.2 = 1216; 3136 mm³ PLA = 3889 mg
    expect(estimatePrint(cfg, cube, s())).toMatchObject({ filament_mg: 3889, support_mg: 0, layers: 100 });
  });
  it('more infill → more filament', () => expect(estimatePrint(cfg, cube, s({ infill_pct: 80 })).filament_mg).toBeGreaterThan(estimatePrint(cfg, cube, s()).filament_mg));
  it('finer layers → longer prints', () => expect(estimatePrint(cfg, cube, s({ layer_height_um: 120 })).print_time_s).toBeGreaterThan(estimatePrint(cfg, cube, s({ layer_height_um: 280 })).print_time_s));
  it('supports none → no support mass', () => {
    const t = { ...cube, overhang_area_mm2: 300 };
    expect(estimatePrint(cfg, t, s({ supports: 'auto' })).support_mg).toBeGreaterThan(0);
    expect(estimatePrint(cfg, t, s({ supports: 'none' })).support_mg).toBe(0);
  });
  it('scale 200% → 8x volume, 4x area', () => {
    const big = estimatePrint(cfg, cube, s({ scale_pct: 200, infill_pct: 100 }));
    expect(big.filament_mg).toBe(Math.round(64000 * 1.24));
  });
  it('denser material → more mass for the same volume', () => expect(estimatePrint(cfg, cube, s({ material: 'PETG' })).filament_mg).toBeGreaterThan(estimatePrint(cfg, cube, s({ material: 'ASA' })).filament_mg));
  it('validates settings', () => {
    expect(validateSettings(cfg, s())).toEqual([]);
    expect(validateSettings(cfg, s({ material: 'ASA', color: 'orange' }))[0]).toMatch(/colour/);
    expect(validateSettings(cfg, s({ layer_height_um: 150 }))[0]).toMatch(/layer height/);
    expect(validateSettings(cfg, s({ infill_pct: 5 }))[0]).toMatch(/infill/);
  });
  it('lead time grows with units and shipping', () => {
    expect(leadTimeDays(cfg, 1, 'standard')).toBe(8);
    expect(leadTimeDays(cfg, 120, 'express')).toBe(7);
  });
});

describe('config', () => {
  it('uses integers for every money value', () => {
    const walk = (v: unknown, p: string, out: [string, number][]) => {
      if (typeof v === 'number') out.push([p, v]);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, out);
    };
    const nums: [string, number][] = [];
    walk(cfg, 'v1', nums);
    for (const [p, n] of nums.filter(([p]) => /minor|bps|cost/.test(p))) expect(Number.isInteger(n), p).toBe(true);
  });
});
