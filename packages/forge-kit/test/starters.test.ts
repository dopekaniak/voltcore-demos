import { beforeAll, describe, expect, it } from 'vitest';
import { bootManifoldKernel } from 'partforge/testing';
import { STARTERS } from '../examples/index.js';
import { extractSchema, validateParams, toPartParams } from '../src/contract';
import { inspectPart } from '../src/runtime/inspect.js';
import { runSandboxed } from '../src/sandbox/runner';
import { starterCode } from '../src/author';
import { staticCheck } from '../src/static-check';

const LIMITS = { timeoutMs: 20000, memoryMb: 1024 };
let kernel: unknown;
beforeAll(async () => {
  kernel = await bootManifoldKernel({ quality: 'preview' });
});

describe.each(STARTERS.map((s) => [s.key] as const))('starter %s', (key) => {
  it('passes the static check', () => {
    expect(staticCheck(starterCode(key))).toEqual({ ok: true, issues: [] });
  });

  it('builds in the sandbox, passes its checks, and renders a thumbnail', async () => {
    const { build } = await runSandboxed({ op: 'build', code: starterCode(key), stl: true, thumbnail: true }, LIMITS);
    expect(build!.report.ok).toBe(true);
    expect(build!.report.verifyOk).toBe(true);
    expect(build!.report.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(build!.stl!.readUInt32LE(80) * 50 + 84).toBe(build!.stl!.length);
    expect(build!.thumbnail!.subarray(1, 4).toString()).toBe('PNG');
    expect(Object.keys(extractSchema(build!.parameters, build!.defaults)).length).toBeGreaterThanOrEqual(3);
  });

  it.each(['stl', '3mf', 'step'] as const)('exports %s', async (format) => {
    const { file } = await runSandboxed({ op: 'export', code: starterCode(key), format }, LIMITS);
    expect(file!.length).toBeGreaterThan(1000);
    if (format === 'stl') expect(file!.readUInt32LE(80) * 50 + 84).toBe(file!.length);
    if (format === '3mf') expect(file!.subarray(0, 2).toString()).toBe('PK');
    if (format === 'step') expect(file!.subarray(0, 13).toString()).toBe('ISO-10303-21;');
  }, 60000);

  it('stays manifold with every numeric parameter at its min and at its max', async () => {
    const part = (await import(`../examples/${key}.js`)).default;
    const schema = extractSchema(part.parameters, part.defaults);
    const numeric = Object.entries(schema).filter(([, s]) => s.type === 'number');
    const cases: Record<string, number>[] = [];
    for (const [k, s] of numeric) {
      if (s.type !== 'number') continue;
      cases.push({ [k]: s.min }, { [k]: s.max });
    }
    cases.push(Object.fromEntries(numeric.map(([k, s]) => [k, s.type === 'number' ? s.min : 0])));
    cases.push(Object.fromEntries(numeric.map(([k, s]) => [k, s.type === 'number' ? s.max : 0])));
    for (const c of cases) {
      const { values } = validateParams(schema, c);
      const report = inspectPart(kernel, part, toPartParams(schema, values));
      for (const sp of report.subparts) {
        expect(sp.watertight, `${key} ${JSON.stringify(c)} ${sp.name}`).toBe(true);
        expect(sp.triangles).toBeGreaterThan(0);
      }
    }
  }, 120000);
});
