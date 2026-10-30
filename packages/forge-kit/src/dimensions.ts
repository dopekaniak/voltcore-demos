import type { ParamSchema, ParamValues } from './contract';

/**
 * Dimension sources (Module 6 rule 2). A millimetre parameter is `given` (read from the
 * person's description), `default` (a starter's own value the person chose), `assumed` (the
 * author had to pick it; must be confirmed before export), `user` (set by the person), or
 * `measured` (from a calibrated photo).
 */
export interface Dimension {
  source: 'given' | 'default' | 'assumed' | 'user' | 'measured';
  confirmed?: boolean;
  calibration_id?: string;
  line_px?: [[number, number], [number, number]];
  value_mm?: number;
  stale?: boolean;
  needs_rebuild?: string[];
}
export type Dimensions = Record<string, Dimension>;

export const mmKeys = (schema: ParamSchema) => Object.entries(schema).filter(([, s]) => s.type === 'number' && s.unit === 'mm').map(([k]) => k);

export function initialDimensions(schema: ParamSchema, a: { authored: boolean; given: string[] }): Dimensions {
  const out: Dimensions = {};
  for (const k of mmKeys(schema)) out[k] = a.given.includes(k) ? { source: 'given' } : a.authored ? { source: 'assumed', confirmed: false } : { source: 'default' };
  return out;
}

/** Carry dimensions to a new version: changed values become the person's, unless a measurement set them. */
export function nextDimensions(base: Dimensions, schema: ParamSchema, oldParams: ParamValues, newParams: ParamValues, patch: Dimensions = {}): Dimensions {
  const out: Dimensions = {};
  for (const k of mmKeys(schema)) {
    const prev = base[k] ?? { source: 'default' };
    if (patch[k]) out[k] = patch[k]!;
    else if (oldParams[k] === newParams[k]) out[k] = prev;
    else if (prev.source === 'measured' && prev.value_mm === newParams[k]) out[k] = { source: 'measured', ...(prev.calibration_id ? { calibration_id: prev.calibration_id } : {}), ...(prev.line_px ? { line_px: prev.line_px } : {}), value_mm: prev.value_mm! };
    else out[k] = { source: 'user' };
  }
  return out;
}

/** Assumed dimensions still unconfirmed for an export at `params` (changed values count as the person's). */
export function unconfirmedAssumed(dims: Dimensions | null | undefined, versionParams: ParamValues, params: ParamValues): string[] {
  return Object.entries(dims ?? {})
    .filter(([k, d]) => d.source === 'assumed' && !d.confirmed && (params[k] === undefined || params[k] === versionParams[k]))
    .map(([k]) => k);
}
