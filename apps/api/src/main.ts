import { Redis } from 'ioredis';
import { loadEnv } from '@sw/config';
import { createDb, makeRepos } from '@sw/db';
import { storageFromEnv } from '@sw/storage';
import { providerRegistry } from '@sw/providers';
import { MeshClient } from '@sw/shared/node';
import { buildApp } from './app';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
const app = await buildApp({ env, db, repos: makeRepos(db), redis, storage: storageFromEnv(env), mesh: new MeshClient({ url: env.MESH_URL, token: env.MESH_SERVICE_TOKEN }), providers: providerRegistry(env), now: () => new Date(), version: process.env.npm_package_version ?? '0.0.0' });

const close = async () => {
  await app.close();
  await db.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
