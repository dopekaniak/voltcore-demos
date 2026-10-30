import { describe, expect, it } from 'vitest';
import { baseFootprint, bendingEstimate, ESTIMATE_LABEL, tipOverEstimate } from '../src/estimates';

describe('engineering estimates', () => {
  it('tip-over of a 20 × 20 block with its centre of mass 40 mm up is atan(10/40)', () => {
    const square: [number, number][] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const e = tipOverEstimate({ centerOfMass: [0, 0, 40], footprint: square });
    expect(e.value).toBeCloseTo(14.0, 1);
    expect(e.formula).toBe('θ = atan(d / h)');
    expect(e.label).toBe(ESTIMATE_LABEL);
    expect(e.code).toBe('ESTIMATE_NOT_CERTIFIED');
  });
  it('a centre of mass outside the base does not stand', () => {
    expect(tipOverEstimate({ centerOfMass: [30, 0, 10], footprint: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }).value).toBe(0);
  });
  it('the base footprint is the hull of the lowest vertices', () => {
    const pos = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 5, 5, 0, 50, 50, 30];
    expect(baseFootprint(pos)).toHaveLength(4);
  });
  it('bending: σ = 6FL/(bt²) for a 40 × 10 × 2 mm arm with 10 N', () => {
    const e = bendingEstimate({ feature: 'snap_arm', size: [40, 10, 2], loadN: 10, material: 'PLA' });
    expect(e.value).toBeCloseTo(60, 5); // 6·10·40 / (10·4)
    expect(e.summary).not.toMatch(/safe|will hold/i);
    expect(e.assumptions.length).toBeGreaterThan(1);
  });
});
