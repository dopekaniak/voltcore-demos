import { Redis } from 'ioredis';
import { loadEnv, type Env } from '@sw/config';
import { createDb } from '@sw/db';
import { buildApp } from '../src/app';
import type { AppContext } from '../src/context';

export async function makeTestApp(overrides: Partial<Env> = {}) {
  const env = { ...loadEnv({ ...process.env, LOG_LEVEL: 'silent' }), ...overrides };
  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
  const ctx: AppContext = { env, db, redis, now: () => new Date(), version: 'test' };
  const app = await buildApp(ctx);
  return {
    app,
    ctx,
    close: async () => {
      await app.close();
      await db.$disconnect();
      redis.disconnect();
    },
  };
}
