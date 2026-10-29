import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '@sw/config';
import { createDb } from '@sw/db';
import { MockAuthor } from '@sw/forge-kit/node';
import { fsStorage } from '@sw/storage';
import type { WorkerContext } from '../src/context';

export function makeWorkerCtx(): WorkerContext & { close(): Promise<void> } {
  const env = loadEnv({ ...process.env, MAIL_DRIVER: 'memory', STORAGE_DIR: mkdtempSync(join(tmpdir(), 'sw-w-')) });
  const db = createDb(env.DATABASE_URL);
  return {
    env,
    db,
    storage: fsStorage({ dir: env.STORAGE_DIR, secret: env.APP_SECRET, publicBase: env.PUBLIC_FILES_BASE }),
    author: new MockAuthor(),
    workerId: 'test-worker',
    log: () => undefined,
    close: () => db.$disconnect(),
  };
}
