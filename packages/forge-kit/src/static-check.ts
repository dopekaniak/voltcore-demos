import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';

/**
 * Static check for AI-written model code (rule 3, ADR-008). It runs before any build, in
 * the server worker and again in the browser worker. It is defense in depth: the sandbox
 * (worker + CSP in the browser, permission-restricted child process on the server) is the
 * boundary, and this check keeps obviously hostile or broken code from reaching it.
 */

/** Modules model code may import. A subset of `partforge` subpaths: the pure ones. */
export const IMPORT_ALLOWLIST = ['partforge/geometry', 'partforge/derive'] as const;

const DENIED_IDENTIFIERS = new Set([
  'require',
  'eval',
  'Function',
  'AsyncFunction',
  'process',
  'globalThis',
  'global',
  'self',
  'window',
  'document',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'navigator',
  'Worker',
  'SharedWorker',
  'postMessage',
  'Deno',
  'Bun',
  'Reflect',
  'Proxy',
  'WebAssembly',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
]);

const DENIED_PROPERTIES = new Set(['constructor', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', 'prototype', 'caller', 'callee']);

export interface StaticIssue {
  rule: 'parse' | 'import' | 'dynamic-import' | 'identifier' | 'property' | 'export' | 'size';
  message: string;
  line: number;
}

export interface StaticCheckResult {
  ok: boolean;
  issues: StaticIssue[];
}

export const MAX_MODEL_BYTES = 200_000;

function lineOf(code: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < code.length; i++) if (code.charCodeAt(i) === 10) line++;
  return line;
}

export function staticCheck(code: string): StaticCheckResult {
  const issues: StaticIssue[] = [];
  if (code.length > MAX_MODEL_BYTES) {
    return { ok: false, issues: [{ rule: 'size', message: `model file is larger than ${MAX_MODEL_BYTES} bytes`, line: 1 }] };
  }
  let ast: Node;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: false });
  } catch (e) {
    const err = e as { message: string; pos?: number };
    return { ok: false, issues: [{ rule: 'parse', message: err.message, line: lineOf(code, err.pos ?? 0) }] };
  }
  const add = (rule: StaticIssue['rule'], message: string, node: Node) => issues.push({ rule, message, line: lineOf(code, node.start) });
  let hasDefault = false;

  type N = Node & Record<string, unknown>;
  const checkSource = (node: N, src: N | null | undefined) => {
    if (!src) return;
    const v = String(src.value);
    if (!(IMPORT_ALLOWLIST as readonly string[]).includes(v)) {
      add('import', `import from "${v}" is not allowed; allowed: ${IMPORT_ALLOWLIST.join(', ')}`, node);
    }
  };

  ancestor(ast, {
    ImportDeclaration(node) {
      const n = node as unknown as N;
      checkSource(n, n.source as N);
    },
    ExportNamedDeclaration(node) {
      const n = node as unknown as N;
      if (n.source) checkSource(n, n.source as N);
    },
    ExportAllDeclaration(node) {
      add('export', 'export * from is not allowed', node);
    },
    ExportDefaultDeclaration() {
      hasDefault = true;
    },
    ImportExpression(node) {
      add('dynamic-import', 'dynamic import() is not allowed', node);
    },
    MetaProperty(node) {
      add('identifier', 'import.meta is not allowed', node);
    },
    Identifier(node, _state, ancestors) {
      const n = node as unknown as { name: string };
      if (!DENIED_IDENTIFIERS.has(n.name)) return;
      const parent = ancestors[ancestors.length - 2] as N | undefined;
      // `obj.fetch` (non-computed property) and `{ fetch: 1 }` keys are names, not references.
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return;
      if (parent?.type === 'MethodDefinition' && parent.key === node) return;
      add('identifier', `"${n.name}" is not available to model code`, node);
    },
    MemberExpression(node) {
      const n = node as unknown as N;
      const prop = n.property as N;
      const name = !n.computed && prop.type === 'Identifier' ? String(prop.name) : prop.type === 'Literal' ? String(prop.value) : null;
      if (name !== null && DENIED_PROPERTIES.has(name)) add('property', `access to ".${name}" is not allowed`, node);
      if (n.computed && containsStringLiteral(prop)) {
        add('property', 'computed property access built from strings is not allowed', node);
      }
    },
    Literal(node) {
      const v = (node as unknown as { value: unknown }).value;
      if (typeof v === 'string' && DENIED_PROPERTIES.has(v)) add('property', `the string "${v}" is not allowed`, node);
    },
    TemplateElement(node) {
      const v = (node as unknown as { value: { cooked: string } }).value.cooked;
      if (v && [...DENIED_PROPERTIES].some((p) => v.includes(p))) add('property', 'template strings naming internal properties are not allowed', node);
    },
  });
  if (!hasDefault && issues.length === 0) {
    issues.push({ rule: 'export', message: 'the model must `export default` a part definition', line: 1 });
  }
  return { ok: issues.length === 0, issues };
}

function containsStringLiteral(n: Record<string, unknown>): boolean {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'Literal' && typeof n.value === 'string') return true;
  if (n.type === 'TemplateLiteral') return true;
  for (const v of Object.values(n)) {
    if (v && typeof v === 'object' && 'type' in (v as object) && containsStringLiteral(v as Record<string, unknown>)) return true;
  }
  return false;
}

/**
 * Replace allowlisted import declarations with lookups in a module table the sandbox
 * provides (`__swModules`), so the code can be evaluated from a data:/blob: URL where bare
 * specifiers cannot resolve. Call only after `staticCheck` passed.
 */
export function rewriteImports(code: string, tableName = '__swModules'): string {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: Record<string, unknown>[] };
  const edits: { start: number; end: number; text: string }[] = [];
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const src = JSON.stringify((node.source as { value: string }).value);
    const mod = `globalThis.${tableName}[${src}]`;
    const specs = node.specifiers as { type: string; local: { name: string }; imported?: { name: string } }[];
    const parts: string[] = [];
    const named = specs.filter((s) => s.type === 'ImportSpecifier').map((s) => (s.imported!.name === s.local.name ? s.local.name : `${s.imported!.name}: ${s.local.name}`));
    for (const s of specs) {
      if (s.type === 'ImportDefaultSpecifier') parts.push(`const ${s.local.name} = ${mod}.default;`);
      if (s.type === 'ImportNamespaceSpecifier') parts.push(`const ${s.local.name} = ${mod};`);
    }
    if (named.length) parts.push(`const { ${named.join(', ')} } = ${mod};`);
    edits.push({ start: node.start as number, end: node.end as number, text: parts.join(' ') || `void ${mod};` });
  }
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
