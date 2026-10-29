import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { STARTERS } from '../examples/index.js';
import { DFM_PROFILES, DEFAULT_PROFILE } from './runtime/inspect.js';

/** Everything an author gets (build prompt 3.2). */
export interface AuthorContext {
  contract: string;
  examples: { key: string; code: string }[];
  schemaRules: string;
  dfmProfile: (typeof DFM_PROFILES)[keyof typeof DFM_PROFILES];
  /** Present on the single repair attempt. */
  previous?: { code: string; error: string };
}

export interface AuthorResult {
  code: string;
  templateKey?: string;
  notes: string[];
}

/** The forge author is a provider adapter (build prompt 3.2). */
export interface FormAuthor {
  readonly key: string;
  readonly version: string;
  author(prompt: string, ctx: AuthorContext): Promise<AuthorResult>;
}

export function starterCode(key: string): string {
  return readFileSync(new URL(`../examples/${key}.js`, import.meta.url), 'utf8');
}

export const CONTRACT_TEXT = `A model file default-exports a partforge PartDefinition:
{ meta: { title, units: 'mm' }, parameters: [sections with controls], defaults: { key: value },
  derive?: (p) => d, parts: { name: { build: (k, p, d) => Solid, views: { view: true } } },
  views: { name: { label } }, verify?: { process, expect } }.
Imports are limited to partforge/geometry and partforge/derive. Build at the origin, flat on
the bed (z = 0), in millimetres. Every control key must exist in defaults.`;

export const SCHEMA_RULES = `Controls: slider/number (min, max, step, unit), checkbox (on), select/radio (options),
text. Every numeric control has min and max. Out-of-range values are clamped by the platform.`;

export function buildAuthorContext(previous?: { code: string; error: string }): AuthorContext {
  return {
    contract: CONTRACT_TEXT,
    examples: STARTERS.slice(0, 3).map((s) => ({ key: s.key, code: starterCode(s.key) })),
    schemaRules: SCHEMA_RULES,
    dfmProfile: DFM_PROFILES[DEFAULT_PROFILE],
    ...(previous ? { previous } : {}),
  };
}

/** Pick the starter whose keywords best match the prompt. */
export function matchStarter(prompt: string): { key: string; score: number } {
  const words = prompt.toLowerCase().split(/[^a-z0-9]+/);
  let best = { key: 'filleted-box', score: 0 };
  for (const s of STARTERS) {
    const score = s.keywords.reduce((n, kw) => n + (words.includes(kw) ? 1 : 0), 0);
    if (score > best.score) best = { key: s.key, score };
  }
  return best;
}

const NUM = String.raw`(\d+(?:\.\d+)?)\s*(?:mm|millimet(?:er|re)s?)`;
const rx = (s: string) => new RegExp(s, 'i');

/** Dimension hints the mock author can read from a prompt, per starter. */
const HINTS: Record<string, [RegExp, string][]> = {
  'cable-clip': [
    [rx(`for an? ${NUM} (?:cable|wire|cord)`), 'cable'],
    [rx(`${NUM} (?:cable|wire|cord)`), 'cable'],
    [rx(`${NUM} (?:wide|width|long)`), 'width'],
    [rx(`^an? ${NUM} `), 'width'],
    [rx(`${NUM} walls?`), 'wall'],
  ],
  'box-with-lid': [
    [rx(`${NUM} wide`), 'inner_w'],
    [rx(`${NUM} deep`), 'inner_d'],
    [rx(`${NUM} (?:tall|high)`), 'inner_h'],
    [rx(`${NUM} walls?`), 'wall'],
    [rx(`${NUM} (?:corner|radius)`), 'radius'],
  ],
  planter: [
    [rx(`${NUM} (?:across|wide|diameter)`), 'diameter'],
    [rx(`${NUM} (?:tall|high)`), 'height'],
    [rx(`${NUM} walls?`), 'wall'],
    [rx(String.raw`(\d+) drainage holes?`), 'holes'],
  ],
  'filleted-box': [
    [rx(`${NUM} by \\d+(?:\\.\\d+)?\\s*mm`), 'w'],
    [rx(String.raw`\d+(?:\.\d+)?\s*(?:mm)?\s*by\s*${NUM}`), 'd'],
    [rx(`${NUM} wide`), 'w'],
    [rx(`${NUM} deep`), 'd'],
    [rx(`${NUM} (?:tall|high)`), 'h'],
    [rx(`${NUM} (?:rounded )?corners?`), 'corner'],
    [rx(`${NUM} walls?`), 'wall'],
  ],
};

export function readHints(key: string, prompt: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [re, param] of HINTS[key] ?? []) {
    if (param in out) continue;
    const m = re.exec(prompt);
    if (m?.[1]) out[param] = Number(m[1]);
  }
  return out;
}

/** Replace the `defaults` object literal of a model file with new values. */
export function withDefaults(code: string, overrides: Record<string, number>): string {
  if (Object.keys(overrides).length === 0) return code;
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: Record<string, unknown>[] };
  const exp = ast.body.find((n) => n.type === 'ExportDefaultDeclaration') as { declaration: { properties: Record<string, unknown>[] } } | undefined;
  const prop = exp?.declaration.properties?.find((p) => (p.key as { name?: string })?.name === 'defaults') as { value: { start: number; end: number; properties: { key: { name: string }; value: { value: unknown } }[] } } | undefined;
  if (!prop) return code;
  const current: Record<string, unknown> = {};
  for (const p of prop.value.properties) current[p.key.name] = p.value.value;
  const merged = { ...current, ...overrides };
  const text = `{ ${Object.entries(merged).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`;
  return code.slice(0, prop.value.start) + text + code.slice(prop.value.end);
}

/**
 * Mock author (FORGE_AUTHOR=mock): returns a bundled starter forge for the prompt, with
 * any dimensions it can read from the prompt written into its defaults. Out-of-range
 * hints are passed through on purpose: the platform clamps, and the checks panel reports
 * values the printer cannot handle (for example a 0.8 mm wall).
 *
 * Deterministic test markers: a prompt containing `[[broken]]` gets code that fails to
 * build on the first attempt (the repair attempt returns the clean starter);
 * `[[broken-always]]` fails on the repair too.
 */
export class MockAuthor implements FormAuthor {
  readonly key = 'mock';
  readonly version = 'mock-1';

  async author(prompt: string, ctx: AuthorContext): Promise<AuthorResult> {
    const { key, score } = matchStarter(prompt);
    const notes: string[] = [];
    if (score === 0) notes.push('No starter matched the description closely; started from the filleted box.');
    const hints = readHints(key, prompt);
    for (const [k, v] of Object.entries(hints)) notes.push(`Read ${k} = ${v} from the description.`);
    let code = withDefaults(starterCode(key), hints);
    const brokenAlways = prompt.includes('[[broken-always]]');
    const broken = brokenAlways || prompt.includes('[[broken]]');
    if (broken && (!ctx.previous || brokenAlways)) {
      code = code.replace(/build: \(k, p, d\) => \{/, "build: (k, p, d) => { throw new Error('mock author: deliberately broken build');");
      notes.push('Mock author returned a deliberately broken build.');
    } else if (ctx.previous) {
      notes.push('Repair attempt: returned the clean starter.');
    }
    return { code, templateKey: key, notes };
  }
}
