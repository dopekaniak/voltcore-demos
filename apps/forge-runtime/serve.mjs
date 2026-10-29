// Static server for the built sandbox runtime with its security headers.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { sandboxHeaders } from './csp.mjs';

const root = join(import.meta.dirname, 'dist');
const port = Number(process.env.PORT ?? 3002);
const headers = sandboxHeaders(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`forge runtime on :${port}`));
