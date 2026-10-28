import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './index';
import { seed } from './seed';

/**
 * Recreate the TEST database schema from migrations and seed it. Refuses to touch any
 * database whose name does not end in `_test`.
 */
export async function prepareTestDb(url = process.env.TEST_DATABASE_URL): Promise<void> {
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`refusing to reset non-test database "${name}"`);
  const db = createDb(url);
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await db.$executeRawUnsafe('CREATE SCHEMA public');
  await db.$disconnect();
  const pkgDir = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: pkgDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  await seed(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prepareTestDb()
    .then(() => console.log('test database ready'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
