import { Redis } from 'ioredis';
import { loadEnv, type Env } from '@sw/config';
import { createDb, makeRepos } from '@sw/db';
import { storageFromEnv } from '@sw/storage';
import { providerRegistry } from '@sw/providers';
import { MeshClient } from '@sw/shared/node';
import { buildApp } from '../src/app';
import type { AppContext } from '../src/context';

export async function makeTestApp(overrides: Partial<Env> = {}) {
  const env = { ...loadEnv({ ...process.env, LOG_LEVEL: 'silent' }), ...overrides };
  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
  const ctx: AppContext = { env, db, repos: makeRepos(db), redis, storage: storageFromEnv(env), mesh: new MeshClient({ url: env.MESH_URL, token: env.MESH_SERVICE_TOKEN }), providers: providerRegistry(env), now: () => new Date(), version: 'test', rateLimitNamespace: `sw-rl-test-${crypto.randomUUID()}:` };
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

export const ORIGIN = 'http://localhost:3000';
type TestApp = Awaited<ReturnType<typeof makeTestApp>>;

/** Sign in through the real magic-link flow and return a cookie header for the session. */
export async function signIn(t: TestApp, email = `u-${crypto.randomUUID()}@example.test`, extraCookie = '') {
  const req = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link',
    headers: { origin: ORIGIN, ...(extraCookie ? { cookie: extraCookie } : {}) },
    payload: { email },
  });
  if (req.statusCode !== 202) throw new Error(`magic link failed: ${req.body}`);
  const msg = await t.ctx.db.outboxMessage.findFirstOrThrow({
    where: { topic: 'email', payload: { path: ['to'], equals: email.toLowerCase() } },
    orderBy: { id: 'desc' },
  });
  const url = new URL((msg.payload as { vars: { url: string } }).vars.url);
  const token = url.searchParams.get('token')!;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link/consume',
    headers: { origin: ORIGIN, ...(extraCookie ? { cookie: extraCookie } : {}) },
    payload: { token },
  });
  if (res.statusCode !== 200) throw new Error(`consume failed: ${res.body}`);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const session = setCookie.find((c) => c.startsWith('sw_session='))!.split(';')[0]!;
  const body = res.json();
  return { cookie: session, user: body.user, token, email, userId: body.user.id as string };
}

/** Inject helper that adds the session cookie and Origin header. */
export function as(t: TestApp, cookie: string) {
  return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

export function bearer(t: TestApp, key: string) {
  return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url, headers: { authorization: `Bearer ${key}`, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
