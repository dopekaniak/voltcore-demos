import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const MESH_DIR = fileURLToPath(new URL('../../mesh', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

/** Start the real Python mesh service for integration tests. */
export async function startMeshService(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const proc: ChildProcess = spawn(`${MESH_DIR}/.venv/bin/uvicorn`, ['app.main:app', '--port', String(port), '--log-level', 'warning'], {
    cwd: MESH_DIR,
    env: { ...process.env, MESH_SERVICE_TOKEN: process.env.MESH_SERVICE_TOKEN ?? 'dev-mesh-service-token' },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 400; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { url, stop: () => proc.kill() };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('mesh service did not start (run pnpm mesh:setup)');
}
