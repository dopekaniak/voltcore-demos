import type { Redis } from 'ioredis';
import type { Env } from '@sw/config';
import type { Db } from '@sw/db';

/** Everything a route needs; built once in main.ts and injected so tests can swap parts. */
export interface AppContext {
  env: Env;
  db: Db;
  redis: Redis;
  now: () => Date;
  version: string;
}
