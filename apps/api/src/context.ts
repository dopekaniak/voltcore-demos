import type { Redis } from 'ioredis';
import type { Env } from '@sw/config';
import type { Db, Repos } from '@sw/db';
import type { Storage } from '@sw/storage';
import type { ModelProvider } from '@sw/providers';
import type { MeshClient } from '@sw/shared/node';

/** Everything a route needs; built once in main.ts and injected so tests can swap parts. */
export interface AppContext {
  env: Env;
  db: Db;
  repos: Repos;
  redis: Redis;
  storage: Storage;
  mesh: MeshClient;
  providers: Map<string, ModelProvider>;
  now: () => Date;
  version: string;
  /** Redis key namespace for rate limits (tests isolate runs with a random one). */
  rateLimitNamespace?: string;
}
