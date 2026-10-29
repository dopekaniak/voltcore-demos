import { describe, expect, it } from 'vitest';
import { rewriteImports, staticCheck } from '../src/static-check';

const ok = "export default { parts: {} };";
const rules = (code: string) => staticCheck(code).issues.map((i) => i.rule);

describe('static check', () => {
  it('accepts a plain part and allowlisted imports', () => {
    expect(staticCheck(ok).ok).toBe(true);
    expect(staticCheck(`import { offsetPolygon } from 'partforge/geometry';\n${ok}`).ok).toBe(true);
  });
  it.each([
    ["import fs from 'node:fs';", 'import'],
    ["import x from 'three';", 'import'],
    ["import x from 'partforge';", 'import'],
    ["export * from 'partforge/geometry';", 'export'],
    ["const m = import('node:fs');", 'dynamic-import'],
    ["fetch('https://example.com');", 'identifier'],
    ["const r = require('fs');", 'identifier'],
    ["eval('1');", 'identifier'],
    ["new Function('return 1')();", 'identifier'],
    ["process.exit(1);", 'identifier'],
    ["globalThis.x = 1;", 'identifier'],
    ["const w = new WebSocket('ws://x');", 'identifier'],
    ["importScripts('x.js');", 'identifier'],
    ["[].constructor.constructor('return this')();", 'property'],
    ["({}).__proto__.x = 1;", 'property'],
    ["const a = []; a['con' + 'structor'];", 'property'],
    ["const k = 'constructor';", 'property'],
    ["const u = import.meta.url;", 'identifier'],
  ])('rejects %s', (snippet, rule) => {
    expect(rules(`${snippet}\n${ok}`)).toContain(rule);
  });
  it('allows the same names as plain object keys and property names', () => {
    expect(staticCheck(`const o = { fetch: 1, process: 2 }; const p = o.process;\n${ok}`).ok).toBe(true);
  });
  it('allows numeric computed indexing', () => {
    expect(staticCheck(`const a = [1, 2]; const i = 1; const b = a[i] + a[i - 1] + a[0];\n${ok}`).ok).toBe(true);
  });
  it('reports parse errors with a line number', () => {
    const r = staticCheck('export default {\n  parts: {\n');
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.rule).toBe('parse');
    expect(r.issues[0]!.line).toBeGreaterThanOrEqual(2);
  });
  it('requires a default export', () => {
    expect(rules('const x = 1;')).toEqual(['export']);
  });
  it('rewrites allowlisted imports to the sandbox module table', () => {
    const out = rewriteImports(`import a, { b, c as d } from 'partforge/geometry';\nimport * as n from 'partforge/derive';\n${ok}`);
    expect(out).toContain('const a = globalThis.__swModules["partforge/geometry"].default;');
    expect(out).toContain('const { b, c: d } = globalThis.__swModules["partforge/geometry"];');
    expect(out).toContain('const n = globalThis.__swModules["partforge/derive"];');
    expect(out).not.toMatch(/^import /m);
  });
});
