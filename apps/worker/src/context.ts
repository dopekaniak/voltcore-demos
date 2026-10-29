import type { Env } from '@sw/config';
import type { Db } from '@sw/db';
import type { FormAuthor } from '@sw/forge-kit/node';
import type { Storage } from '@sw/storage';
import type { ModelProvider } from '@sw/providers';
import type { MeshClient } from '@sw/shared/node';

export interface WorkerContext {
  env: Env;
  db: Db;
  storage: Storage;
  author: FormAuthor;
  mesh: MeshClient;
  providers: Map<string, ModelProvider>;
  /** Poll interval per provider key (ms). */
  pollMs?: Record<string, number>;
  workerId: string;
  log: (msg: string, extra?: object) => void;
}
