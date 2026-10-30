import { describe, expect, it } from 'vitest';
import { buildAuthorContext, matchStarter, MockAuthor, readHints, withDefaults, starterCode } from '../src/author';
import { staticCheck } from '../src/static-check';

describe('MockAuthor', () => {
  const author = new MockAuthor();
  it('matches the cable clip prompt from the build prompt and reads its dimensions', async () => {
    const r = await author.author('a 40 mm cable clip for a 6 mm cable, with a snap closure', buildAuthorContext());
    expect(r.templateKey).toBe('cable-clip');
    expect(r.code).toMatch(/defaults: \{ cable: 6, width: 40,/);
    expect(staticCheck(r.code).ok).toBe(true);
  });
  it('matches boxes, planters, and trays', () => {
    expect(matchStarter('a storage box with a lid').key).toBe('box-with-lid');
    expect(matchStarter('small planter for succulents').key).toBe('planter');
    expect(matchStarter('rounded desk tray').key).toBe('filleted-box');
    expect(matchStarter('something unusual')).toEqual({ key: 'filleted-box', score: 0 });
  });
  it('reads hints per starter', () => {
    expect(readHints('box-with-lid', 'box 80 mm wide, 50 mm deep and 30 mm tall with 1.6 mm walls')).toEqual({ inner_w: 80, inner_d: 50, inner_h: 30, wall: 1.6 });
    expect(readHints('planter', 'a planter 120 mm across with 6 drainage holes')).toEqual({ diameter: 120, holes: 6 });
  });
  it('gives the author the contract, three examples, the schema rules, and the profile', () => {
    const ctx = buildAuthorContext();
    expect(ctx.examples).toHaveLength(3);
    expect(ctx.contract).toContain('PartDefinition');
    expect(ctx.dfmProfile.minWall).toBe(1.2);
  });
  it('honours the deterministic broken markers', async () => {
    const first = await author.author('box [[broken]]', buildAuthorContext());
    expect(first.code).toContain('deliberately broken');
    const repair = await author.author('box [[broken]]', buildAuthorContext({ code: first.code, error: 'x' }));
    expect(repair.code).not.toContain('deliberately broken');
    const always = await author.author('box [[broken-always]]', buildAuthorContext({ code: first.code, error: 'x' }));
    expect(always.code).toContain('deliberately broken');
  });
  it('rewrites only the defaults literal', () => {
    const code = withDefaults(starterCode('planter'), { holes: 3 });
    expect(code).toContain('holes: 3');
    expect(code.length).toBeGreaterThan(1000);
  });
});

describe('MockAuthor.edit (copilot)', async () => {
  const { MockAuthor: Author, readEdit, buildAuthorContext: ctx, starterCode: src } = await import('../src/author');
  const { extractSchema, validateParams } = await import('../src/contract');
  const { analyzeFeatures, featureSource } = await import('../src/features');
  const code = src('planter');
  const part = (await import('../examples/planter.js')).default;
  const schema = extractSchema(part.parameters, part.defaults);
  const params = validateParams(schema, {}).values;
  const a = new Author();

  it('reads relative and absolute size changes', () => {
    expect(readEdit('make the holes 4 mm larger')).toMatchObject({ amount: 4, adjective: 'larger', absolute: false });
    expect(readEdit('make it 2 mm narrower')).toMatchObject({ amount: -2 });
    expect(readEdit('set the height to 120 mm')).toMatchObject({ amount: 120, absolute: true });
    expect(readEdit('add a lip on the left edge')).toBeNull();
  });

  it('a whole-model edit changes a parameter value', async () => {
    expect((await a.edit({ code, message: 'make the holes 4 mm larger', schema, params }, ctx())).params).toEqual({ hole_d: 10 });
    expect((await a.edit({ code, message: 'set the height to 120 mm', schema, params }, ctx())).params).toEqual({ height: 120 });
  });

  it('a feature edit rewrites only the target builder', async () => {
    const rim = analyzeFeatures(code).features.find((f) => f.key === 'rim')!;
    const r = await a.edit({ code, message: 'make it 2 mm wider', schema, params, feature: { key: 'rim', source: featureSource(code, 'rim')!, params: rim.params } }, ctx());
    expect(r.code).toBeUndefined();
    expect(r.featureSource).toContain('(p.rim + 2)');
    expect(r.featureSource).not.toMatch(/[^(]p\.rim\b(?! \+)/);
  });

  it('declines what it cannot do', async () => {
    await expect(a.edit({ code, message: 'add a lip on the left edge', schema, params }, ctx())).rejects.toThrow(/only change sizes/);
  });
});
