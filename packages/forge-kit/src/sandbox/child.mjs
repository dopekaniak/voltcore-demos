// Forge sandbox child process (ADR-008). Started by runner.ts with Node's permission model:
// read-only access to the forge-kit package and node_modules, no fs writes, no child
// processes, no worker threads, no addons, a heap cap, and a hard kill at the build timeout.
//
// Network: remove the global network APIs and make socket connects throw before any model
// code is loaded. Model code is also statically checked before it reaches this process.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

const denied = () => {
  throw new Error('network access is not available in the forge sandbox');
};
for (const g of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Request', 'Response', 'Headers']) {
  try {
    Object.defineProperty(globalThis, g, { value: undefined, configurable: false, writable: false });
  } catch {
    /* already gone */
  }
}
net.connect = net.createConnection = denied;
net.Socket.prototype.connect = denied;
tls.connect = denied;
dns.lookup = dns.resolve = denied;
dns.promises.lookup = dns.promises.resolve = denied;
http.request = http.get = https.request = https.get = denied;
process.binding = denied;
if (process.permission && process.permission.has('fs.write')) {
  // The runner must start this file under the permission model; refuse to run otherwise.
  process.send?.({ ok: false, error: { code: 'SANDBOX_MISCONFIGURED', message: 'fs write permission is granted' } });
  process.exit(3);
}

const toB64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

async function loadPart(code) {
  const [geometry, derive] = await Promise.all([import('partforge/geometry'), import('partforge/derive')]);
  globalThis.__swModules = Object.freeze({ 'partforge/geometry': geometry, 'partforge/derive': derive });
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  const mod = await import(url);
  const part = mod.default;
  if (!part || typeof part !== 'object' || !part.parts) throw Object.assign(new Error('the model does not export a part definition'), { code: 'FORGE_CONTRACT' });
  if (mod.features && typeof mod.features === 'object') Object.defineProperty(part, '__swFeatures', { value: mod.features, enumerable: false });
  return part;
}

function jsonSafe(v) {
  return JSON.parse(JSON.stringify(v ?? null));
}

async function exportWith(kernel, part, view, params, format) {
  const { handle } = await import('partforge/testing');
  const { mergeBinaryStl } = await import('../runtime/inspect.js');
  const msgs = [];
  const type = format === 'stl' ? 'export-stl' : format === '3mf' ? 'export-3mf' : 'export-step';
  await handle(kernel, part, { type, view, params, jobId: 1, name: 'forge', quality: 'print' }, (m) => msgs.push(m));
  const last = msgs.at(-1);
  if (!last || last.type === 'error') throw new Error(last?.message ?? 'export produced no output');
  if (last.type === 'download-parts') return mergeBinaryStl(last.parts.map((p) => new Uint8Array(p.data.buffer ?? p.data)));
  return new Uint8Array(last.data.buffer ?? last.data, last.data.byteOffset ?? 0, last.data.byteLength);
}

async function run(msg) {
  const part = await loadPart(msg.code);
  const { lintPart } = await import('partforge/lint');
  const lint = lintPart(part, { params: msg.params ?? {} });
  if (!lint.ok) {
    const first = lint.errors[0];
    throw Object.assign(new Error(`${first.rule}: ${first.message} ${first.hint}`), { code: 'FORGE_LINT', details: lint.errors.slice(0, 5) });
  }
  const { inspectPart, defaultView, featureBoxes } = await import('../runtime/inspect.js');
  const view = defaultView(part);
  const params = { ...(part.defaults ?? {}), ...(msg.params ?? {}) };

  if (msg.op === 'export' && msg.format === 'step') {
    const { bootOcctKernel } = await import('partforge/testing');
    const k = await bootOcctKernel();
    return { file: toB64(await exportWith(k, part, view, params, 'step')) };
  }

  const { bootManifoldKernel, renderViewImages } = await import('partforge/testing');
  const k = await bootManifoldKernel({ quality: 'print' });
  if (msg.op === 'export') return { file: toB64(await exportWith(k, part, view, params, msg.format)) };

  // op === 'build': schema data, checks, preview STL, thumbnail.
  const report = inspectPart(k, part, params, msg.profile);
  const out = {
    meta: jsonSafe(part.meta),
    parameters: jsonSafe(part.parameters),
    defaults: jsonSafe(part.defaults),
    views: Object.keys(part.views ?? {}),
    report,
    warnings: lint.warnings.slice(0, 10).map((w) => `${w.rule}: ${w.message}`),
  };
  if (msg.featureParts && part.__swFeatures) out.features = featureBoxes(k, part, part.__swFeatures, msg.featureParts, params);
  if (msg.stl) out.stl = toB64(await exportWith(k, part, view, params, 'stl'));
  if (msg.thumbnail) {
    const imgs = await renderViewImages(k, part, view, { views: ['iso'], size: [480, 360], params, supersample: 1 });
    out.thumbnail = toB64(imgs[0].png);
  }
  return out;
}

process.once('message', async (msg) => {
  try {
    const result = await run(msg);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (e) {
    process.send(
      { ok: false, error: { code: e?.code && typeof e.code === 'string' ? e.code : 'FORGE_BUILD_ERROR', message: String(e?.message ?? e).slice(0, 2000), details: e?.details ?? null } },
      () => process.exit(0),
    );
  }
});
