// Development: rebuild the sandbox runtime on change and serve dist/ with the production
// CSP. (Vite's dev server injects its HMR client into worker modules, which breaks them.)
import { spawn } from 'node:child_process';
import { build } from 'vite';

await build({ build: { watch: {} }, logLevel: 'warn' });
const server = spawn(process.execPath, ['serve.mjs'], { stdio: 'inherit', cwd: import.meta.dirname, env: process.env });
const stop = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
