import { loadEnv } from '@sw/config';
import { createDb } from '@sw/db';
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
const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ level: 'info', msg, ...extra }));

const workers = [
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
  const r = await reap(db);
  if (r.released || r.expiredGrants || r.renewed) log('reaper', r);
});
log('worker ready', { provider: env.PROVIDER_MODE, slicer: env.SLICER_MODE });

const stop = async () => {
  stopping = true;
  await Promise.all(workers.map((w) => w.close()));
  await publisher.close();
  await db.$disconnect();
  conn.disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
