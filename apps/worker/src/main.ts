import { loadEnv } from '@sw/config';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { createDb } from '@sw/db';
import { MockAuthor } from '@sw/forge-kit/node';
import { storageFromEnv } from '@sw/storage';
import type { WorkerContext } from './context';
import { dispatchForge, dispatchGeneration, dispatchMesh } from './dispatch';
import { providerRegistry } from '@sw/providers';
import { MeshClient } from '@sw/shared/node';
import { createMailer } from './mailer';
import { processEmail, type EmailPayload } from './processors/email';
import { reap } from './processors/reaper';
import { processWebhookDelivery } from './processors/webhook-delivery';
import { makePublisher, redisConnection, startWorker } from './queues';
import { relayOnce } from './relay';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const conn = redisConnection(env.REDIS_URL);
const publisher = makePublisher(conn);
const mailer = createMailer(env);
function log(msg: string, extra: object = {}) {
  return console.log(JSON.stringify({ level: 'info', msg, ...extra }));
}

const ctx: WorkerContext = { env, db, storage: storageFromEnv(env), author: new MockAuthor(), mesh: new MeshClient({ url: env.MESH_URL, token: env.MESH_SERVICE_TOKEN }), providers: providerRegistry(env), workerId: `${hostname()}:${process.pid}`, log };

const workers = [
  startWorker('generation', conn, async (job) => dispatchGeneration(ctx, job.data as { jobId: string; poll?: boolean }), 8),
  startWorker('mesh-analysis', conn, async (job) => dispatchMesh(ctx, (job.data as { jobId: string }).jobId), 2),
  startWorker('forge-build', conn, async (job) => dispatchForge(ctx, (job.data as { jobId: string }).jobId), 2),
  startWorker('email', conn, async (job) => processEmail(mailer, job.data as EmailPayload)),
  startWorker('webhook-delivery', conn, async (job) => processWebhookDelivery(db, env, (job.data as { deliveryId: string }).deliveryId)),
];

let stopping = false;
async function loop(name: string, everyMs: number, fn: () => Promise<unknown>) {
  while (!stopping) {
    try {
      await fn();
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: `${name} failed`, err: String(e) }));
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
void loop('outbox-relay', 500, () => relayOnce(db, publisher));
void loop('reaper', 60_000, async () => {
  const r = await reap(db, new Date(), ctx.storage);
  if (r.released || r.expiredGrants || r.renewed || r.purged) log('reaper', r);
});
// Liveness endpoint for orchestration and the E2E harness.
const health = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', worker: ctx.workerId }));
}).listen(Number(process.env.WORKER_HEALTH_PORT ?? 4100));
log('worker ready', { provider: env.PROVIDER_MODE, slicer: env.SLICER_MODE });

const stop = async () => {
  stopping = true;
  health.close();
  await Promise.all(workers.map((w) => w.close()));
  await publisher.close();
  await db.$disconnect();
  conn.disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
