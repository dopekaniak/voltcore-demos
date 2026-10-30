import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUSTOMIZERS } from '../customizers/index.js';
import { extractSchema } from '../src/contract';
import { injectRelief, validateCustomizerInputs } from '../src/customizer';
import { runSandboxed } from '../src/sandbox/runner';
import { staticCheck } from '../src/static-check';
import nameplate from '../customizers/nameplate.js';

const code = (k: string) => readFileSync(new URL(`../customizers/${k}.js`, import.meta.url), 'utf8');
const LIMITS = { timeoutMs: 20000, memoryMb: 1024 };

describe.each(CUSTOMIZERS.map((c) => [c.key] as const))('customizer %s', (key) => {
  it('passes the static check and builds with passing checks', async () => {
    expect(staticCheck(code(key)).ok).toBe(true);
    const { build } = await runSandboxed({ op: 'build', code: code(key) }, LIMITS);
    expect(build!.report.ok).toBe(true);
  });
});

describe('customizer inputs', () => {
  const schema = extractSchema(nameplate.parameters, nameplate.defaults);
  const rules = { label: { maxLength: 16, charset: "A-Za-z0-9 .'&-" } };
  it('accepts allowed text and clamps out-of-range sizes with a message', () => {
    const v = validateCustomizerInputs(schema, rules, { label: "Jo-Ann & Bo's", width: 500 });
    expect(v.invalid).toEqual([]);
    expect(v.values.width).toBe(120);
    expect(v.clamped[0]!.message).toBe('Width was lowered to the maximum, 120 mm.');
  });
  it('rejects characters outside the allowlist and over-long text', () => {
    expect(validateCustomizerInputs(schema, rules, { label: 'HI<script>' }).invalid[0]!.message).toMatch(/can only use letters, numbers, spaces/);
    expect(validateCustomizerInputs(schema, rules, { label: 'A'.repeat(17) }).invalid[0]!.message).toBe('Name can be at most 16 characters.');
  });
});

describe('relief injection', () => {
  it('injects a validated grid as data and the result still passes the static check', async () => {
    const grid = { width: 4, height: 4, data: Array.from({ length: 16 }, (_, i) => i * 4000) };
    const out = injectRelief(code('relief-coaster'), grid);
    expect(out).toContain('"width":4');
    expect(staticCheck(out).ok).toBe(true);
    const { build } = await runSandboxed({ op: 'build', code: out }, LIMITS);
    expect(build!.report.subparts[0]!.watertight).toBe(true);
  });
  it('refuses malformed grids and customizers without an image input', () => {
    expect(() => injectRelief(code('relief-coaster'), { width: 4, height: 4, data: [1, 2] })).toThrow();
    expect(() => injectRelief(code('relief-coaster'), { width: 2, height: 1, data: [1, 70000] })).toThrow();
    expect(() => injectRelief(code('nameplate'), { width: 2, height: 2, data: [1, 2, 3, 4] })).toThrow(/does not take an image/);
  });
});
