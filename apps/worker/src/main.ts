import { loadEnv } from '@sw/config';
import { createDb } from '@sw/db';

/** Worker entry. Processors and the outbox relay are registered per slice. */
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
await db.$queryRaw`SELECT 1`;
console.log(JSON.stringify({ level: 'info', msg: 'worker ready', provider: env.PROVIDER_MODE, slicer: env.SLICER_MODE }));

const stop = async () => {
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
