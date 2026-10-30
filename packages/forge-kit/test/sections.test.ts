import { describe, expect, it } from 'vitest';
import { starterCode } from '../src/author';
import { runSandboxed } from '../src/sandbox/runner';

const LIMITS = { timeoutMs: 30000, memoryMb: 1500 };

function stlBounds(b: Buffer) {
  const n = b.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
    const x = b.readFloatLE(84 + t * 50 + 12 + v * 12 + a * 4);
    min[a] = Math.min(min[a]!, x);
    max[a] = Math.max(max[a]!, x);
  }
  return { min, max };
}

describe('test sections', () => {
  it('a snap-fit ridge cut as a test section matches the feature bounds within 0.05 mm and passes its checks', async () => {
    const r = await runSandboxed({ op: 'section', code: starterCode('box-with-lid'), featureKey: 'ridge' }, LIMITS);
    const b = stlBounds(r.file!);
    for (let a = 0; a < 3; a++) {
      expect(Math.abs(b.min[a]! - r.section!.box.min[a]!)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(b.max[a]! - r.section!.box.max[a]!)).toBeLessThanOrEqual(0.05);
    }
    expect(r.section!.report.subparts[0]!.watertight).toBe(true);
    expect(r.section!.report.checks.find((c) => c.id === 'bed-fit')!.status).toBe('pass');
  }, 60000);

  it('a plane slab section keeps only the part between the planes', async () => {
    const r = await runSandboxed({ op: 'section', code: starterCode('planter'), box: { min: [-200, -200, 80], max: [200, 200, 90] } }, LIMITS);
    const b = stlBounds(r.file!);
    expect(b.min[2]).toBeCloseTo(80, 1);
    expect(b.max[2]).toBeCloseTo(90, 1);
  }, 60000);

  it('an empty section is refused', async () => {
    await expect(runSandboxed({ op: 'section', code: starterCode('planter'), box: { min: [500, 500, 500], max: [510, 510, 510] } }, LIMITS)).rejects.toThrow(/section is empty/);
  }, 60000);
});
