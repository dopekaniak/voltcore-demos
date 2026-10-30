import { describe, expect, it } from 'vitest';
import { calibrate, measure } from '../src/calibration';
import { PRINTER_PROFILES, dfmFromPrinter } from '../profiles/index.js';

const img = { width: 1200, height: 900 };

describe('calibration math', () => {
  it('a known pixel length and a known mm length give the expected scale', () => {
    const c = calibrate(img, [[100, 100], [400, 500]], 60); // 500 px
    expect(c.lengthPx).toBe(500);
    expect(c.mmPerPx).toBeCloseTo(0.12, 10);
    expect(measure(img, [[0, 0], [500, 0]], c.mmPerPx)).toBe(60);
  });
  it('rejects a zero-length line', () => {
    expect(() => calibrate(img, [[10, 10], [10, 10]], 60)).toThrow(/too short/);
  });
  it('rejects endpoints outside the image', () => {
    expect(() => calibrate(img, [[10, 10], [1300, 10]], 60)).toThrow(/inside the 1200 × 900 px photo/);
    expect(() => calibrate(img, [[-1, 10], [100, 10]], 60)).toThrow(/inside/);
  });
  it('rejects a missing or non-positive real length', () => {
    expect(() => calibrate(img, [[0, 0], [100, 0]], 0)).toThrow(/more than 0/);
    expect(() => calibrate(img, [[0, 0], [100, 0]], Number.NaN)).toThrow(/more than 0/);
  });
  it('recalibrating to 58 mm scales measured dimensions', () => {
    const line: [[number, number], [number, number]] = [[0, 0], [500, 0]];
    expect(measure(img, line, calibrate(img, line, 58).mmPerPx)).toBe(58);
  });
});

describe('printer profiles', () => {
  it('the generic profile is the default and uses the entered bed size', () => {
    const g = PRINTER_PROFILES.find((p) => p.is_generic)!;
    expect(PRINTER_PROFILES[0]).toBe(g);
    expect(dfmFromPrinter(g, [300, 300, 300]).bed).toEqual([300, 300, 300]);
  });
  it('every named profile records its source and retrieval date', () => {
    for (const p of PRINTER_PROFILES.filter((x) => !x.is_generic)) {
      expect(p.source_url).toMatch(/^https:\/\//);
      expect(p.retrieved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
