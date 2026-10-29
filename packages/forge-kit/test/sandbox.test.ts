import { describe, expect, it } from 'vitest';
import { runSandboxed, SandboxError } from '../src/sandbox/runner';
import { starterCode } from '../src/author';

const LIMITS = { timeoutMs: 20000, memoryMb: 1024 };
const withBuild = (body: string) =>
  starterCode('planter').replace("build: (k, p, d) => {", `build: (k, p, d) => { ${body}`);

async function failure(p: Promise<unknown>): Promise<SandboxError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SandboxError);
    return e as SandboxError;
  }
  throw new Error('expected the sandbox to refuse');
}

describe('forge sandbox (security checklist)', () => {
  it('refuses fetch at the static check', async () => {
    const e = await failure(runSandboxed({ op: 'build', code: withBuild("fetch('https://example.com');") }, LIMITS));
    expect(e.code).toBe('FORGE_STATIC_CHECK_FAILED');
  });

  it('has no network even when the static check is bypassed', async () => {
    const e = await failure(runSandboxed({ op: 'build', code: withBuild("fetch('https://example.com');") }, LIMITS, { skipStaticCheck: true }));
    expect(e.code).toBe('FORGE_BUILD_FAILED');
    expect(e.message).toMatch(/fetch is not a function|not available|not defined/);
  });

  it('cannot open sockets even through node:net when the static check is bypassed', async () => {
    const code = `import net from 'node:net';\n${withBuild("net.connect(80, 'example.com');")}`;
    const e = await failure(runSandboxed({ op: 'build', code }, LIMITS, { skipStaticCheck: true }));
    expect(e.message).toMatch(/network access is not available/);
  });

  it('refuses an unlisted import at the static check', async () => {
    const e = await failure(runSandboxed({ op: 'build', code: `import fs from 'node:fs';\n${starterCode('planter')}` }, LIMITS));
    expect(e.code).toBe('FORGE_STATIC_CHECK_FAILED');
    expect(e.message).toMatch(/node:fs/);
  });

  it('cannot write files even when the static check is bypassed', async () => {
    const code = `import fs from 'node:fs';\n${withBuild("fs.writeFileSync('/tmp/forge-escape.txt', 'x');")}`;
    const e = await failure(runSandboxed({ op: 'build', code }, LIMITS, { skipStaticCheck: true }));
    expect(e.message).toMatch(/ERR_ACCESS_DENIED|Access to this API has been restricted/);
  });

  it('cannot start child processes when the static check is bypassed', async () => {
    const code = `import cp from 'node:child_process';\n${withBuild("cp.execSync('id');")}`;
    const e = await failure(runSandboxed({ op: 'build', code }, LIMITS, { skipStaticCheck: true }));
    expect(e.message).toMatch(/ERR_ACCESS_DENIED|restricted/);
  });

  it('kills an infinite loop at the timeout', async () => {
    const t0 = Date.now();
    const e = await failure(runSandboxed({ op: 'build', code: withBuild('while (true) {}') }, { timeoutMs: 2500, memoryMb: 1024 }));
    expect(e.code).toBe('FORGE_BUILD_TIMEOUT');
    expect(Date.now() - t0).toBeLessThan(6000);
  });

  it('stops a build that allocates past the memory cap', async () => {
    const e = await failure(runSandboxed({ op: 'build', code: withBuild('const a = []; for (;;) a.push(new Array(1e6).fill(1));') }, { timeoutMs: 20000, memoryMb: 400 }));
    expect(['FORGE_BUILD_MEMORY', 'SANDBOX_CRASHED']).toContain(e.code);
  });

  it('reports a build error as FORGE_BUILD_FAILED with the message', async () => {
    const e = await failure(runSandboxed({ op: 'build', code: withBuild("throw new Error('boom');") }, LIMITS));
    expect(e.code).toBe('FORGE_BUILD_FAILED');
    expect(e.message).toContain('boom');
  });
});
