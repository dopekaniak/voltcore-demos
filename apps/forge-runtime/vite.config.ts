import { defineConfig } from 'vite';
// @ts-expect-error plain JS helper shared with serve.mjs
import { sandboxHeaders } from './csp.mjs';

const webOrigin = process.env.VITE_WEB_ORIGIN ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  server: { port: 3002, strictPort: true, hmr: false, headers: sandboxHeaders(webOrigin, true) },
  preview: { port: 3002, strictPort: true, headers: sandboxHeaders(webOrigin) },
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  optimizeDeps: { include: ['acorn', 'acorn-walk'], exclude: ['partforge', 'manifold-3d', 'replicad-opencascadejs'] },
  define: { 'import.meta.env.VITE_WEB_ORIGIN': JSON.stringify(webOrigin) },
});
