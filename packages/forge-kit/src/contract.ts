/**
 * The flat parameter schema the API stores and validates against (ADR-007). It is derived
 * from a partforge PartDefinition's `parameters` (sections of controls, including the
 * legacy `advanced` / `features` shapes) and `defaults`.
 */

export type ParamSpec =
  | { type: 'number'; default: number; min: number; max: number; step: number; unit?: string; label: string; description?: string; hidden?: boolean; section?: string }
  | { type: 'boolean'; default: boolean; on: number; label: string; description?: string; hidden?: boolean; section?: string }
  | { type: 'enum'; default: string | number; options: { value: string | number; label: string }[]; label: string; description?: string; hidden?: boolean; section?: string }
  | { type: 'text'; default: string; maxLength: number; label: string; description?: string; hidden?: boolean; section?: string };

export type ParamSchema = Record<string, ParamSpec>;
export type ParamValues = Record<string, number | string | boolean>;

export interface Clamp {
  key: string;
  requested: unknown;
  applied: number | string | boolean;
  reason: 'below-min' | 'above-max' | 'not-an-option' | 'too-long' | 'wrong-type' | 'step';
}

export interface ValidationResult {
  values: ParamValues;
  clamped: Clamp[];
  unknown: string[];
}

type Ctl = Record<string, unknown>;

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Walk sections, groups, and legacy shapes, collecting every bound control. */
export function extractSchema(parameters: unknown, defaults: Record<string, unknown>): ParamSchema {
  const schema: ParamSchema = {};
  const visit = (ctl: Ctl, section: string | undefined) => {
    const type = (ctl.type as string | undefined) ?? 'slider';
    if (type === 'group') {
      for (const c of (ctl.controls as Ctl[] | undefined) ?? []) visit(c, section);
      return;
    }
    if (type === 'preset' || type === 'readout' || type === 'custom') return;
    const key = ctl.key as string | undefined;
    if (!key || !(key in defaults) || schema[key]) return;
    const def = defaults[key];
    const label = String(ctl.label ?? key);
    const base = {
      label,
      ...(typeof ctl.description === 'string' ? { description: ctl.description } : {}),
      ...(ctl.hidden === true ? { hidden: true } : {}),
      ...(section ? { section } : {}),
    };
    if (type === 'slider' || type === 'number') {
      const min = asNumber(ctl.min, Math.min(0, asNumber(def, 0)));
      const max = asNumber(ctl.max, Math.max(min + 1, asNumber(def, 1)));
      schema[key] = { type: 'number', default: asNumber(def, min), min, max, step: asNumber(ctl.step, 1), ...(typeof ctl.unit === 'string' ? { unit: ctl.unit } : {}), ...base };
    } else if (type === 'checkbox') {
      const on = asNumber(ctl.on, 1);
      schema[key] = { type: 'boolean', default: Boolean(def) && def !== 0, on, ...base };
    } else if (type === 'select' || type === 'radio') {
      const options = ((ctl.options as unknown[]) ?? []).map((o) =>
        typeof o === 'object' && o !== null ? { value: (o as Ctl).value as string | number, label: String((o as Ctl).label ?? (o as Ctl).value) } : { value: o as string | number, label: String(o) },
      );
      schema[key] = { type: 'enum', default: def as string | number, options, ...base };
    } else if (type === 'text' || type === 'textarea') {
      schema[key] = { type: 'text', default: String(def ?? ''), maxLength: asNumber(ctl.maxLength, 200), ...base };
    }
  };
  for (const sec of (Array.isArray(parameters) ? parameters : []) as Ctl[]) {
    const title = typeof sec.title === 'string' ? sec.title : undefined;
    for (const c of (sec.controls as Ctl[] | undefined) ?? []) visit(c, title);
    // Legacy shapes: `advanced` sliders and `features` toggles with their own sliders.
    for (const c of (sec.advanced as Ctl[] | undefined) ?? []) visit(c, title);
    for (const f of (sec.features as Ctl[] | undefined) ?? []) {
      for (const sl of (f.sliders as Ctl[] | undefined) ?? []) visit(sl, title);
    }
  }
  return schema;
}

function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Validate and clamp values against a schema. Out-of-range numbers are clamped to the
 * range and reported so the UI can say so. Unknown keys are dropped and reported.
 */
export function validateParams(schema: ParamSchema, input: Record<string, unknown>): ValidationResult {
  const values: ParamValues = {};
  const clamped: Clamp[] = [];
  const unknown = Object.keys(input).filter((k) => !(k in schema));
  for (const [key, spec] of Object.entries(schema)) {
    const has = Object.prototype.hasOwnProperty.call(input, key);
    const raw = has ? input[key] : spec.default;
    switch (spec.type) {
      case 'number': {
        let n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) {
          clamped.push({ key, requested: raw, applied: spec.default, reason: 'wrong-type' });
          n = spec.default;
        } else if (n < spec.min) {
          clamped.push({ key, requested: raw, applied: spec.min, reason: 'below-min' });
          n = spec.min;
        } else if (n > spec.max) {
          clamped.push({ key, requested: raw, applied: spec.max, reason: 'above-max' });
          n = spec.max;
        }
        // Keep finer-than-step values but avoid float noise.
        values[key] = Number(n.toFixed(Math.max(decimals(spec.step), 3)));
        break;
      }
      case 'boolean': {
        const b = typeof raw === 'boolean' ? raw : typeof raw === 'number' ? raw !== 0 : raw === 'true';
        if (has && typeof raw !== 'boolean' && typeof raw !== 'number' && raw !== 'true' && raw !== 'false') {
          clamped.push({ key, requested: raw, applied: spec.default, reason: 'wrong-type' });
          values[key] = spec.default;
        } else values[key] = b;
        break;
      }
      case 'enum': {
        const ok = spec.options.some((o) => o.value === raw);
        if (!ok) clamped.push({ key, requested: raw, applied: spec.default, reason: 'not-an-option' });
        values[key] = ok ? (raw as string | number) : spec.default;
        break;
      }
      case 'text': {
        let s = typeof raw === 'string' ? raw : String(raw ?? '');
        if (s.length > spec.maxLength) {
          clamped.push({ key, requested: raw, applied: s.slice(0, spec.maxLength), reason: 'too-long' });
          s = s.slice(0, spec.maxLength);
        }
        values[key] = s;
        break;
      }
    }
  }
  return { values, clamped, unknown };
}

/** Values in partforge's own form (checkboxes write `on` or 0). */
export function toPartParams(schema: ParamSchema, values: ParamValues): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(values)) {
    const spec = schema[k];
    if (spec?.type === 'boolean') out[k] = v ? spec.on : 0;
    else out[k] = v as number | string;
  }
  return out;
}

/** Plain-language clamp message for the UI. */
export function clampMessage(c: Clamp, spec: ParamSpec | undefined): string {
  const label = spec?.label ?? c.key;
  const unit = spec && spec.type === 'number' && spec.unit ? ` ${spec.unit}` : '';
  switch (c.reason) {
    case 'below-min':
      return `${label} was raised to the minimum, ${c.applied}${unit}.`;
    case 'above-max':
      return `${label} was lowered to the maximum, ${c.applied}${unit}.`;
    case 'not-an-option':
      return `${label} is not one of the options; using ${c.applied}.`;
    case 'too-long':
      return `${label} was shortened to ${String(c.applied).length} characters.`;
    default:
      return `${label} was not a valid value; using ${c.applied}${unit}.`;
  }
}
