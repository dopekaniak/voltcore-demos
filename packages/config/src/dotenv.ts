import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Load the nearest `.env` walking up from cwd, without overriding variables already set. */
export function loadDotenv(start = process.cwd()): string | null {
  let dir = start;
  for (;;) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      const before = { ...process.env };
      process.loadEnvFile(file);
      for (const [k, v] of Object.entries(before)) process.env[k] = v;
      return file;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
