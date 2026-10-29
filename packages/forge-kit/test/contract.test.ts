import { describe, expect, it } from 'vitest';
import { clampMessage, extractSchema, toPartParams, validateParams } from '../src/contract';
import boxPart from '../examples/box-with-lid.js';
import clipPart from '../examples/cable-clip.js';

describe('schema extraction', () => {
  it('reads sliders, units, ranges, and checkboxes', () => {
    const s = extractSchema(boxPart.parameters, boxPart.defaults);
    expect(s.inner_w).toMatchObject({ type: 'number', min: 20, max: 200, unit: 'mm', default: 60, section: 'Inside size' });
    expect(s.snap).toMatchObject({ type: 'boolean', default: true, on: 1 });
  });
  it('reads legacy advanced/features shapes and selects', () => {
    const s = extractSchema(
      [
        { title: 'A', advanced: [{ key: 'od', min: 4, max: 40, step: 0.5 }] },
        { title: 'B', features: [{ key: 'f', sliders: [{ key: 'fd', min: 1, max: 9 }] }] },
        { title: 'C', controls: [{ key: 'shape', type: 'select', options: ['round', { value: 'hex', label: 'Hex' }] }, { type: 'readout', derivedKey: 'x' }] },
      ],
      { od: 8, fd: 2, shape: 'round' },
    );
    expect(Object.keys(s).sort()).toEqual(['fd', 'od', 'shape']);
    expect(s.shape).toMatchObject({ type: 'enum', options: [{ value: 'round', label: 'round' }, { value: 'hex', label: 'Hex' }] });
  });
});

describe('parameter validation and clamping', () => {
  const s = extractSchema(clipPart.parameters, clipPart.defaults);
  it('fills defaults and keeps valid values', () => {
    const r = validateParams(s, { cable: 8 });
    expect(r.values.cable).toBe(8);
    expect(r.values.width).toBe(10);
    expect(r.clamped).toEqual([]);
  });
  it('clamps out-of-range values and says so', () => {
    const r = validateParams(s, { cable: 100, wall: 0.1, width: 'abc', extra: 1 });
    expect(r.values).toMatchObject({ cable: 20, wall: 0.8, width: 10 });
    expect(r.clamped.map((c) => [c.key, c.reason])).toEqual([
      ['cable', 'above-max'],
      ['width', 'wrong-type'],
      ['wall', 'below-min'],
    ]);
    expect(r.unknown).toEqual(['extra']);
    expect(clampMessage(r.clamped[0]!, s.cable)).toBe('Cable diameter was lowered to the maximum, 20 mm.');
  });
  it('converts booleans to partforge checkbox values', () => {
    const bs = extractSchema(boxPart.parameters, boxPart.defaults);
    const { values } = validateParams(bs, { snap: false });
    expect(toPartParams(bs, values).snap).toBe(0);
    expect(toPartParams(bs, validateParams(bs, {}).values).snap).toBe(1);
  });
});
