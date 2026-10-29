import type { Env } from '@sw/config';
import type { Db } from '@sw/db';
import type { FormAuthor } from '@sw/forge-kit/node';
import type { Storage } from '@sw/storage';

export interface WorkerContext {
  env: Env;
  db: Db;
  storage: Storage;
  author: FormAuthor;
  workerId: string;
  log: (msg: string, extra?: object) => void;
}
