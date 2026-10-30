import { beforeAll, describe, expect, it } from 'vitest';
import { bootManifoldKernel, handle } from 'partforge/testing';
import { STARTERS } from '../examples/index.js';
import { starterCode } from '../src/author';
import { analyzeFeatures, featureSource, replaceFeature, resolveSelection, type FeatureBox } from '../src/features';
import { defaultView, featureBoxes, subpartsFor } from '../src/runtime/inspect.js';
import { runSandboxed } from '../src/sandbox/runner';
import { staticCheck } from '../src/static-check';

const LIMITS = { timeoutMs: 20000, memoryMb: 1024 };

describe('named-feature contract', () => {
  it.each(STARTERS.map((s) => s.key))('starter %s declares labeled features used by its parts', (key) => {
    const a = analyzeFeatures(starterCode(key));
    expect(a.issues).toEqual([]);
    expect(a.featured).toBe(true);
    for (const f of a.features) expect(f.part, f.key).not.toBeNull();
  });

  it('reports a forge without named features', () => {
    const a = analyzeFeatures('export default { parts: { a: { build: (k) => k.box({ size: [1, 1, 1] }) } } };');
    expect(a.featured).toBe(false);
    expect(a.issues[0]).toMatch(/no `export const features/);
  });

  it('requires each builder to label its solid with its own key', () => {
    const a = analyzeFeatures("export const features = { rim: (k) => k.box({ size: [1, 1, 1] }).label('lip') };\nexport default { parts: {} };");
    expect(a.featured).toBe(false);
    expect(a.issues).toContain("feature \"rim\" must label its solid with .label('rim')");
  });

  it('lists the parameters a feature reads', () => {
    const rim = analyzeFeatures(starterCode('planter')).features.find((f) => f.key === 'rim')!;
    expect(rim.params).toEqual(['height', 'rim', 'rim_h']);
  });
});

describe('replaceFeature', () => {
  const code = starterCode('planter');
  const newRim = "(k, p, d) => k.cylinder({ d: d.top + 2 * p.rim + 4, h: p.rim_h }).at([0, 0, p.height - p.rim_h]).cut(k.cylinder({ d: d.innerTop, h: p.rim_h + 2 }).at([0, 0, p.height - p.rim_h - 1])).label('rim')";

  it('changes only the rim block; every other feature and all code outside the block is byte-identical', () => {
    const before = analyzeFeatures(code);
    const out = replaceFeature(code, 'rim', newRim);
    const after = analyzeFeatures(out);
    const rimBefore = before.features.find((f) => f.key === 'rim')!;
    const rimAfter = after.features.find((f) => f.key === 'rim')!;
    expect(out.slice(0, rimBefore.range[0])).toBe(code.slice(0, rimBefore.range[0]));
    expect(out.slice(rimAfter.range[1])).toBe(code.slice(rimBefore.range[1]));
    for (const key of ['wall', 'cavity', 'drain']) expect(featureSource(out, key)).toBe(featureSource(code, key));
    expect(featureSource(out, 'rim')).toBe(newRim);
    expect(staticCheck(out).ok).toBe(true);
  });

  it('the edited forge still builds and is manifold', async () => {
    const { build } = await runSandboxed({ op: 'build', code: replaceFeature(code, 'rim', newRim) }, LIMITS);
    expect(build!.report.subparts.every((s) => s.watertight)).toBe(true);
    expect(build!.features!.find((f) => f.key === 'rim')!.bbox!.max[2]).toBeCloseTo(90, 1);
  });

  it('refuses an edit that drops the label or targets a missing feature', () => {
    expect(() => replaceFeature(code, 'rim', '(k, p, d) => k.box({ size: [1, 1, 1] })')).toThrow(/not a labeled builder/);
    expect(() => replaceFeature(code, 'handle', newRim)).toThrow(/no feature "handle"/);
  });
});

describe('selection → feature', () => {
  let boxes: FeatureBox[];
  let meshFeatures: string[];
  beforeAll(async () => {
    const kernel = await bootManifoldKernel({ quality: 'preview' });
    const part = (await import('../examples/planter.js')).default;
    const feats = (await import('../examples/planter.js')).features;
    const a = analyzeFeatures(starterCode('planter'));
    boxes = featureBoxes(kernel, part, feats, Object.fromEntries(a.features.map((f) => [f.key, f.part])), {});
    const msgs: Record<string, unknown>[] = [];
    const view = defaultView(part);
    await handle(kernel as never, part as never, { type: 'generate', view, params: {}, subparts: subpartsFor(part, view, {}), jobId: 1 } as never, (m) => msgs.push(m));
    const meshes = (msgs.find((m) => m.type === 'meshes')?.meshes ?? []) as { features?: string[] }[];
    meshFeatures = meshes.flatMap((m) => m.features ?? []);
  });

  it('the preview mesh attributes triangles to the named features', () => {
    expect(meshFeatures).toEqual(expect.arrayContaining(['wall', 'cavity', 'rim', 'drain']));
  });

  it('a circle drawn on the rim maps to the rim feature', () => {
    // Points on the outside of the rim band, a few on the wall just below it.
    const hits = [
      ...Array.from({ length: 14 }, (_, i) => ({ feature: 'rim', point: [52 * Math.cos(i / 4), 52 * Math.sin(i / 4), 86 + (i % 3)] as [number, number, number] })),
      ...Array.from({ length: 4 }, (_, i) => ({ feature: 'wall', point: [49.5 * Math.cos(i / 4), 49.5 * Math.sin(i / 4), 82] as [number, number, number] })),
    ];
    expect(resolveSelection(boxes, hits)).toMatchObject({ kind: 'feature', key: 'rim' });
  });

  it('an even split between two features asks the person to pick', () => {
    const hits = [
      ...Array.from({ length: 5 }, () => ({ feature: 'rim', point: [52, 0, 86] as [number, number, number] })),
      ...Array.from({ length: 5 }, () => ({ feature: 'wall', point: [49.5, 0, 60] as [number, number, number] })),
    ];
    const r = resolveSelection(boxes, hits);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.key).sort()).toEqual(['rim', 'wall']);
  });

  it('unlabeled hits inside overlapping bounds are ambiguous, outside the part are nothing', () => {
    expect(resolveSelection(boxes, [{ feature: null, point: [0, 0, 1] }]).kind).toBe('ambiguous');
    expect(resolveSelection(boxes, [{ feature: null, point: [500, 500, 500] }])).toEqual({ kind: 'none' });
  });

  it('a label that disagrees with its feature bounds is not trusted', () => {
    const r = resolveSelection(boxes, [{ feature: 'rim', point: [0, 0, 1] }]);
    expect(r.kind === 'feature' && r.key === 'rim').toBe(false);
  });
});
