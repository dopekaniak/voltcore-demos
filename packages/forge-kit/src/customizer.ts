import { clampMessage, validateParams, type Clamp, type ParamSchema, type ParamValues } from './contract';

export interface InputRule {
  maxLength?: number;
  /** Character class body, e.g. "A-Za-z0-9 .'&-". */
  charset?: string;
}

export interface CustomizerValidation {
  values: ParamValues;
  clamped: (Clamp & { message: string })[];
  invalid: { key: string; message: string }[];
}

/** Text inputs are rejected (not trimmed) when they break their rule; numbers are clamped. */
export function validateCustomizerInputs(schema: ParamSchema, rules: Record<string, InputRule>, inputs: Record<string, unknown>): CustomizerValidation {
  const invalid: { key: string; message: string }[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const v = inputs[key];
    if (v === undefined) continue;
    const label = schema[key]?.label ?? key;
    if (typeof v !== 'string') {
      invalid.push({ key, message: `${label} must be text.` });
      continue;
    }
    if (rule.maxLength !== undefined && [...v].length > rule.maxLength) invalid.push({ key, message: `${label} can be at most ${rule.maxLength} characters.` });
    if (rule.charset && !new RegExp(`^[${rule.charset.replace(/[\\\]^]/g, '\\$&')}]*$`, 'u').test(v)) {
      const extra = rule.charset.replace('A-Za-z0-9', '').replace(' ', '').split('').join(' ');
      invalid.push({ key, message: `${label} can only use letters, numbers, spaces${extra ? `, and ${extra}` : ''}.` });
    }
  }
  const r = validateParams(schema, inputs);
  return { values: r.values, clamped: r.clamped.map((c) => ({ ...c, message: clampMessage(c, schema[c.key]) })), invalid };
}

export interface ReliefGrid {
  width: number;
  height: number;
  data: number[];
}

const MARKER = '/*__SW_RELIEF__*/ null';

/** Insert a validated height map into a customizer's code (data only, never code). */
export function injectRelief(code: string, grid: ReliefGrid | null): string {
  if (!grid) return code;
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width * grid.height !== grid.data.length) throw new Error('invalid relief grid');
  if (!grid.data.every((n) => Number.isInteger(n) && n >= 0 && n <= 65535)) throw new Error('invalid relief samples');
  if (!code.includes(MARKER)) throw new Error('this customizer does not take an image');
  return code.replace(MARKER, JSON.stringify({ width: grid.width, height: grid.height, data: grid.data }));
}
