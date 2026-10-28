import { Redis } from 'ioredis';
import { loadEnv } from '@sw/config';
import { createDb } from '@sw/db';
import { buildApp } from './app';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
const app = await buildApp({ env, db, redis, now: () => new Date(), version: process.env.npm_package_version ?? '0.0.0' });

const close = async () => {
  await app.close();
  await db.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
