import { fork } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteImports, staticCheck, type StaticIssue } from '../static-check';
import type { ForgeReport } from '../types';
import { analyzeFeatures } from '../features';
import type { DfmProfile, FeatureBoxRow } from '../runtime/inspect.js';

export interface SandboxLimits {
  timeoutMs: number;
  memoryMb: number;
}

export type SandboxRequest =
  | { op: 'build'; code: string; params?: Record<string, unknown>; profile?: string | DfmProfile; stl?: boolean; thumbnail?: boolean }
  | { op: 'export'; code: string; params?: Record<string, unknown>; format: 'stl' | '3mf' | 'step' };

export interface BuildOutput {
  meta: { title?: string } | null;
  parameters: unknown;
  defaults: Record<string, unknown>;
  views: string[];
  report: ForgeReport;
  warnings: string[];
  stl?: Buffer;
  thumbnail?: Buffer;
  /** Named-feature bounds (featured forges only). */
  features?: FeatureBoxRow[];
}

export class SandboxError extends Error {
  constructor(
    readonly code: 'FORGE_STATIC_CHECK_FAILED' | 'FORGE_BUILD_TIMEOUT' | 'FORGE_BUILD_MEMORY' | 'FORGE_BUILD_FAILED' | 'SANDBOX_CRASHED',
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const CHILD = resolve(here, 'child.mjs');

/** Directories the child may read: this package and the resolved partforge install. */
function readRoots(): string[] {
  const pkgRoot = resolve(here, '../..');
  const pf = realpathSync(resolve(pkgRoot, 'node_modules/partforge'));
  // pnpm keeps dependencies in a shared store; allow the whole store directory that holds them.
  const store = pf.includes('/node_modules/.pnpm/') ? pf.slice(0, pf.indexOf('/node_modules/.pnpm/') + '/node_modules/.pnpm/'.length) : resolve(pf, '..');
  return [pkgRoot, store, resolve(pkgRoot, 'node_modules')];
}

function rssMb(pid: number): number | null {
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
    return (Number(statm[1]) * 4096) / 1024 / 1024;
  } catch {
    return null;
  }
}

/**
 * Run one sandboxed forge operation. Static check first, then a child process under the
 * permission model with a heap cap, an RSS watchdog, and a hard timeout.
 */
export async function runSandboxed(
  req: SandboxRequest,
  limits: SandboxLimits,
  opts: { skipStaticCheck?: boolean } = {},
): Promise<{ build?: BuildOutput; file?: Buffer }> {
  if (!opts.skipStaticCheck) {
    const check = staticCheck(req.code);
    if (!check.ok) {
      throw new SandboxError('FORGE_STATIC_CHECK_FAILED', formatIssues(check.issues), check.issues);
    }
  }
  const code = opts.skipStaticCheck ? req.code : rewriteImports(req.code);
  const execArgv = [
    '--experimental-permission',
    ...readRoots().map((r) => `--allow-fs-read=${r}/*`),
    `--max-old-space-size=${Math.max(128, Math.floor(limits.memoryMb * 0.75))}`,
    '--no-warnings',
    '--disable-proto=throw',
  ];
  const child = fork(CHILD, [], { execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced', env: {} });
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => {
    if (stderr.length < 8000) stderr += c.toString();
  });

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new SandboxError('FORGE_BUILD_TIMEOUT', `The build did not finish within ${Math.round(limits.timeoutMs / 1000)} s.`))),
      limits.timeoutMs,
    );
    const watchdog = setInterval(() => {
      const mb = child.pid ? rssMb(child.pid) : null;
      if (mb !== null && mb > limits.memoryMb) {
        finish(() => reject(new SandboxError('FORGE_BUILD_MEMORY', `The build used more than ${limits.memoryMb} MB of memory.`)));
      }
    }, 200);
    child.on('message', (m: { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string; details: unknown } }) => {
      finish(() => {
        if (!m.ok) return reject(new SandboxError('FORGE_BUILD_FAILED', m.error?.message ?? 'build failed', m.error));
        const r = m.result ?? {};
        if (req.op === 'export') return resolvePromise({ file: Buffer.from(String(r.file), 'base64') });
        const build: BuildOutput = {
          meta: (r.meta as BuildOutput['meta']) ?? null,
          parameters: r.parameters,
          defaults: (r.defaults as Record<string, unknown>) ?? {},
          views: (r.views as string[]) ?? [],
          report: r.report as ForgeReport,
          warnings: (r.warnings as string[]) ?? [],
          ...(r.stl ? { stl: Buffer.from(String(r.stl), 'base64') } : {}),
          ...(r.thumbnail ? { thumbnail: Buffer.from(String(r.thumbnail), 'base64') } : {}),
          ...(Array.isArray(r.features) ? { features: r.features as FeatureBoxRow[] } : {}),
        };
        resolvePromise({ build });
      });
    });
    child.on('exit', (codeNum, signal) => {
      finish(() =>
        reject(
          new SandboxError('SANDBOX_CRASHED', `The build process stopped unexpectedly (${signal ?? codeNum}).`, { stderr: stderr.slice(0, 2000) }),
        ),
      );
    });
    child.on('error', (e) => finish(() => reject(new SandboxError('SANDBOX_CRASHED', e.message))));
    const featureParts = req.op === 'build' ? featurePartsOf(req.code) : null;
    child.send({ ...req, code, ...(featureParts ? { featureParts } : {}) });
  });
}

export function formatIssues(issues: StaticIssue[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `line ${i.line}: ${i.message}`)
    .join('; ');
}

function featurePartsOf(code: string): Record<string, string | null> | null {
  const a = analyzeFeatures(code);
  if (!a.featured) return null;
  return Object.fromEntries(a.features.map((f) => [f.key, f.part]));
}
