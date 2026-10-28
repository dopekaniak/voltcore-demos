import { describe, expect, it } from 'vitest';
import { PRICING_CONFIGS } from '../src/index';

function walkNumbers(v: unknown, path: string, out: [string, number][]) {
  if (typeof v === 'number') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walkNumbers(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkNumbers(x, `${path}.${k}`, out);
}

describe('pricing config v1', () => {
  it('uses integers for every money value', () => {
    const nums: [string, number][] = [];
    walkNumbers(PRICING_CONFIGS[1], 'v1', nums);
    const money = nums.filter(([p]) => /minor|bps|cost/.test(p));
    expect(money.length).toBeGreaterThan(10);
    for (const [p, n] of money) expect(Number.isInteger(n), p).toBe(true);
  });
  it('is version 1', () => {
    expect(PRICING_CONFIGS[1].pricing_version).toBe(1);
  });
});
