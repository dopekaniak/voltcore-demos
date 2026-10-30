import { parse, type Node } from 'acorn';
import { simple } from 'acorn-walk';

/**
 * Named features (Module 6, ADR-038). A featured forge exports its features as one object
 * literal of builder functions, each returning a solid labeled with its own key:
 *
 *   export const features = {
 *     rim: (k, p, d) => k.cylinder({ ... }).label('rim'),
 *   };
 *
 * and its parts compose them (`features.wall(k, p, d).cut(features.cavity(k, p, d))`). The
 * label makes the kernel attribute every triangle of the built mesh to a feature, so a pick
 * in the viewer names the feature it hit. The source range of each property is the only
 * code a region edit may change.
 */

export const FEATURE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export interface FeatureInfo {
  key: string;
  /** Source range of the property's value (the builder function). */
  range: [number, number];
  /** Parameters (`p.x`) and derived values (`d.x`) the builder reads. */
  params: string[];
  derived: string[];
  /** The sub-part whose build uses this feature, when one does. */
  part: string | null;
  labeled: boolean;
}

export interface FeatureAnalysis {
  featured: boolean;
  features: FeatureInfo[];
  issues: string[];
}

type N = Node & Record<string, unknown>;

function parseModule(code: string): N {
  return parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as N;
}

function keyName(prop: N): string | null {
  if (prop.computed) return null;
  const k = prop.key as N;
  if (k.type === 'Identifier') return String(k.name);
  if (k.type === 'Literal' && typeof k.value === 'string') return k.value;
  return null;
}

function findFeaturesObject(ast: N): N | null {
  for (const stmt of ast.body as N[]) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? (stmt.declaration as N | null) : null;
    if (!decl || decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations as N[]) {
      const id = d.id as N;
      if (id.type === 'Identifier' && id.name === 'features' && (d.init as N | null)?.type === 'ObjectExpression') return d.init as N;
    }
  }
  return null;
}

function paramName(fn: N, i: number): string | null {
  const ps = (fn.params as N[] | undefined) ?? [];
  const p = ps[i];
  return p && p.type === 'Identifier' ? String(p.name) : null;
}

function memberReads(fn: N, objName: string | null): string[] {
  if (!objName) return [];
  const out = new Set<string>();
  simple(fn as Node, {
    MemberExpression(node) {
      const n = node as unknown as N;
      const obj = n.object as N;
      const prop = n.property as N;
      if (obj.type === 'Identifier' && obj.name === objName && !n.computed && prop.type === 'Identifier') out.add(String(prop.name));
    },
  });
  return [...out].sort();
}

function hasOwnLabel(fn: N, key: string): boolean {
  let found = false;
  simple(fn as Node, {
    CallExpression(node) {
      const n = node as unknown as N;
      const callee = n.callee as N;
      const arg = (n.arguments as N[])[0];
      if (callee.type === 'MemberExpression' && !callee.computed && (callee.property as N).name === 'label' && arg?.type === 'Literal' && arg.value === key) found = true;
    },
  });
  return found;
}

/** Which sub-part's build references `features.<key>`. */
function partUses(ast: N): Map<string, string> {
  const uses = new Map<string, string>();
  const exp = (ast.body as N[]).find((s) => s.type === 'ExportDefaultDeclaration');
  const obj = exp?.declaration as N | undefined;
  if (obj?.type !== 'ObjectExpression') return uses;
  const partsProp = (obj.properties as N[]).find((p) => keyName(p) === 'parts');
  const parts = partsProp?.value as N | undefined;
  if (parts?.type !== 'ObjectExpression') return uses;
  for (const sub of parts.properties as N[]) {
    const name = keyName(sub);
    if (!name || (sub.value as N).type !== 'ObjectExpression') continue;
    simple(sub.value as Node, {
      MemberExpression(node) {
        const n = node as unknown as N;
        const o = n.object as N;
        const pr = n.property as N;
        if (o.type === 'Identifier' && o.name === 'features' && !n.computed && pr.type === 'Identifier' && !uses.has(String(pr.name))) uses.set(String(pr.name), name);
      },
    });
  }
  return uses;
}

export function analyzeFeatures(code: string): FeatureAnalysis {
  let ast: N;
  try {
    ast = parseModule(code);
  } catch (e) {
    return { featured: false, features: [], issues: [`parse: ${(e as Error).message}`] };
  }
  const obj = findFeaturesObject(ast);
  if (!obj) return { featured: false, features: [], issues: ['the model has no `export const features = { … }` object'] };
  const uses = partUses(ast);
  const issues: string[] = [];
  const features: FeatureInfo[] = [];
  for (const prop of obj.properties as N[]) {
    if (prop.type !== 'Property') {
      issues.push('spread entries are not allowed in `features`');
      continue;
    }
    const key = keyName(prop);
    const fn = prop.value as N;
    if (!key || !FEATURE_KEY.test(key)) {
      issues.push(`feature key ${JSON.stringify(key)} must be lower_snake_case`);
      continue;
    }
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
      issues.push(`feature "${key}" must be a builder function (k, p, d) => solid`);
      continue;
    }
    const labeled = hasOwnLabel(fn, key);
    if (!labeled) issues.push(`feature "${key}" must label its solid with .label('${key}')`);
    features.push({ key, range: [fn.start, fn.end], params: memberReads(fn, paramName(fn, 1)), derived: memberReads(fn, paramName(fn, 2)), part: uses.get(key) ?? null, labeled });
  }
  if (features.length === 0) issues.push('`features` is empty');
  return { featured: issues.length === 0 && features.length > 0, features, issues };
}

export function featureSource(code: string, key: string): string | null {
  const f = analyzeFeatures(code).features.find((x) => x.key === key);
  return f ? code.slice(f.range[0], f.range[1]) : null;
}

/**
 * Replace one feature's builder and nothing else: every byte outside that feature's range
 * is kept. The new builder must parse and still label its solid with the same key.
 */
export function replaceFeature(code: string, key: string, newBuilder: string): string {
  const a = analyzeFeatures(code);
  const f = a.features.find((x) => x.key === key);
  if (!f) throw Object.assign(new Error(`the model has no feature "${key}"`), { code: 'FEATURE_NOT_FOUND' });
  const next = code.slice(0, f.range[0]) + newBuilder.trim() + code.slice(f.range[1]);
  const b = analyzeFeatures(next);
  const nf = b.features.find((x) => x.key === key);
  if (!nf || !nf.labeled || b.features.length !== a.features.length) throw Object.assign(new Error(`the edited "${key}" feature is not a labeled builder`), { code: 'FEATURE_EDIT_INVALID' });
  return next;
}

// ───────────── Selection → feature ─────────────

export type Vec3 = [number, number, number];
export interface FeatureBox {
  key: string;
  /** View-frame bounds in mm; null when the feature is absent at these params. */
  bbox: { min: Vec3; max: Vec3 } | null;
}
export interface SelectionHit {
  /** The feature the kernel attributed the picked triangle to (mesh label), if any. */
  feature?: string | null;
  point: Vec3;
}
export type Resolution = { kind: 'feature'; key: string; share: number } | { kind: 'ambiguous'; candidates: { key: string; share: number }[] } | { kind: 'none' };

const TOL = 0.5;
const contains = (b: FeatureBox['bbox'], p: Vec3) => !!b && p.every((v, i) => v >= b.min[i]! - TOL && v <= b.max[i]! + TOL);

/**
 * Map picked faces to one feature. Labeled hits vote for their feature when the point
 * lies in that feature's bounds; unlabeled hits vote for the single feature whose bounds
 * contain them, or count as ambiguous between all that do. The winner needs half of all
 * votes and twice the runner-up; otherwise the candidates go back to the person to pick.
 */
export function resolveSelection(features: FeatureBox[], hits: SelectionHit[]): Resolution {
  const byKey = new Map(features.map((f) => [f.key, f]));
  const votes = new Map<string, number>();
  const add = (k: string, w: number) => votes.set(k, (votes.get(k) ?? 0) + w);
  let total = 0;
  for (const h of hits) {
    const labeled = h.feature ? byKey.get(h.feature) : undefined;
    if (labeled && (labeled.bbox === null || contains(labeled.bbox, h.point))) {
      add(labeled.key, 1);
      total++;
      continue;
    }
    const inside = features.filter((f) => contains(f.bbox, h.point));
    if (inside.length === 0) continue;
    total++;
    for (const f of inside) add(f.key, 1 / inside.length);
  }
  if (total === 0) return { kind: 'none' };
  const ranked = [...votes.entries()].map(([key, v]) => ({ key, share: Math.round((v / total) * 1000) / 1000 })).sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
  const [top, second] = ranked;
  if (top && top.share >= 0.5 && (!second || top.share >= 2 * second.share)) return { kind: 'feature', key: top.key, share: top.share };
  return { kind: 'ambiguous', candidates: ranked.filter((r) => r.share >= 0.1).slice(0, 5) };
}
