/**
 * Print estimator for SLICER_MODE=estimate (docs/pricing.md, ADR-002b). Deterministic: the
 * same analysis and settings always give the same estimate. Physical quantities may be
 * fractional internally; outputs are integers (mg, seconds).
 */
import { z } from 'zod';
import type { PricingConfig } from './engine';

export const settingsSchema = z.object({
  material: z.string().default('PLA'),
  color: z.string().default('black'),
  layer_height_um: z.number().int().default(200),
  infill_pct: z.number().int().default(20),
  supports: z.enum(['auto', 'none']).default('auto'),
  orientation: z.enum(['as-uploaded', 'auto']).default('as-uploaded'),
  scale_pct: z.number().default(100),
  quantity: z.number().int().default(1),
  shipping: z.enum(['standard', 'express']).default('standard'),
});
export type PrintSettings = z.infer<typeof settingsSchema>;

export interface MeshFacts {
  volume_mm3: number;
  surface_area_mm2: number;
  bbox_mm: [number, number, number];
  overhang_area_mm2: number;
}

export interface Estimate {
  filament_mg: number;
  support_mg: number;
  print_time_s: number;
  layers: number;
  is_estimate: true;
}

/** Validate settings against the config (material, colour, layer height, infill). */
export function validateSettings(cfg: PricingConfig, s: PrintSettings): string[] {
  const problems: string[] = [];
  if (!cfg.materials[s.material]) problems.push(`material must be one of ${Object.keys(cfg.materials).join(', ')}`);
  else if (!(cfg.colors[s.material] ?? []).includes(s.color)) problems.push(`colour must be one of ${(cfg.colors[s.material] ?? []).join(', ')}`);
  if (!cfg.layer_heights_um.includes(s.layer_height_um)) problems.push(`layer height must be one of ${cfg.layer_heights_um.map((x) => x / 1000).join(', ')} mm`);
  if (s.infill_pct < cfg.infill_pct.min || s.infill_pct > cfg.infill_pct.max) problems.push(`infill must be ${cfg.infill_pct.min}–${cfg.infill_pct.max}%`);
  return problems;
}

export function estimatePrint(cfg: PricingConfig, m: MeshFacts, s: PrintSettings): Estimate {
  const e = cfg.estimator;
  const k = s.scale_pct / 100;
  const volume = m.volume_mm3 * k ** 3;
  const area = m.surface_area_mm2 * k ** 2;
  const height = Math.max(...[m.bbox_mm[2]]) * k;
  const overhang = s.supports === 'auto' ? m.overhang_area_mm2 * k ** 2 : 0;
  const density = cfg.materials[s.material]!.density_mg_per_cm3 / 1000; // g/cm3 == mg/mm3
  const shell = Math.min(volume, area * e.shell_mm);
  const infill = (volume - shell) * (s.infill_pct / 100);
  const filamentMm3 = shell + infill;
  const supportMm3 = overhang * (height / 2) * e.support_density;
  const layerMm = s.layer_height_um / 1000;
  const flow = layerMm * e.line_width_mm * e.speed_mm_s;
  const layers = Math.ceil(height / layerMm);
  const seconds = ((filamentMm3 + supportMm3) / flow + layers * e.layer_change_s) * e.travel_factor;
  return {
    filament_mg: Math.round(filamentMm3 * density),
    support_mg: Math.round(supportMm3 * density),
    print_time_s: Math.round(seconds),
    layers,
    is_estimate: true,
  };
}
