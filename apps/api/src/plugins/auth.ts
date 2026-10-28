import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomToken, sha256Hex } from '@sw/shared/node';
import type { AppContext } from '../context';

export const SESSION_COOKIE = 'sw_session';
export const ANON_COOKIE = 'sw_anon';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const API_KEY_PREFIX = 'sw_live_';

export interface AuthInfo {
  kind: 'none' | 'session' | 'apikey';
  userId: string | null;
  role: 'USER' | 'ADMIN' | 'OPS' | null;
  email: string | null;
  /** null = all scopes (browser session). */
  scopes: ReadonlySet<string> | null;
  sessionId: string | null;
  apiKeyId: string | null;
  totpEnabled: boolean;
  totpVerified: boolean;
  planCode: string;
  apiRateLimit: number;
  /** Hashed anonymous-visitor cookie, when present. */
  anonId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo;
  }
}

const NONE: AuthInfo = {
  kind: 'none',
  userId: null,
  role: null,
  email: null,
  scopes: null,
  sessionId: null,
  apiKeyId: null,
  totpEnabled: false,
  totpVerified: false,
  planCode: 'free',
  apiRateLimit: 60,
  anonId: null,
};

async function planFor(ctx: AppContext, userId: string): Promise<{ code: string; apiRateLimitPerMin: number }> {
  const sub = await ctx.db.subscription.findFirst({
    where: { ownerId: userId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  });
  return sub ? { code: sub.plan.code, apiRateLimitPerMin: sub.plan.apiRateLimitPerMin } : { code: 'free', apiRateLimitPerMin: 60 };
}

/** Resolve the caller from an API key (Authorization: Bearer) or the session cookie. */
export function authPlugin(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null as unknown as AuthInfo);
  app.addHook('onRequest', async (req) => {
    const anonCookie = req.cookies[ANON_COOKIE];
    const anonId = anonCookie && /^[A-Za-z0-9_-]{20,100}$/.test(anonCookie) ? sha256Hex(`anon:${anonCookie}`) : null;
    req.auth = { ...NONE, anonId };

    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const key = header.slice(7).trim();
      if (!key.startsWith(API_KEY_PREFIX)) return;
      const row = await ctx.db.apiKey.findUnique({ where: { keyHash: sha256Hex(key) }, include: { owner: true } });
      if (!row || row.revokedAt || row.owner.status !== 'ACTIVE') return;
      const plan = await planFor(ctx, row.ownerId);
      req.auth = {
        ...req.auth,
        kind: 'apikey',
        userId: row.ownerId,
        role: row.owner.role,
        email: row.owner.email,
        scopes: new Set(row.scopes),
        apiKeyId: row.id,
        totpEnabled: row.owner.totpEnabledAt !== null,
        planCode: plan.code,
        apiRateLimit: plan.apiRateLimitPerMin,
      };
      // Throttle last-used writes to once a minute.
      if (!row.lastUsedAt || ctx.now().getTime() - row.lastUsedAt.getTime() > 60_000) {
        void ctx.db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: ctx.now() } }).catch(() => undefined);
      }
      return;
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await ctx.db.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= ctx.now() || session.user.status !== 'ACTIVE') return;
    const plan = await planFor(ctx, session.userId);
    req.auth = {
      ...req.auth,
      kind: 'session',
      userId: session.userId,
      role: session.user.role,
      email: session.user.email,
      scopes: null,
      sessionId: session.id,
      totpEnabled: session.user.totpEnabledAt !== null,
      totpVerified: session.totpVerifiedAt !== null,
      planCode: plan.code,
      apiRateLimit: plan.apiRateLimitPerMin,
    };
  });
}

export function cookieOptions(ctx: AppContext, maxAgeS: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.env.NODE_ENV === 'production',
    maxAge: maxAgeS,
  };
}

/** Return the anonymous id, issuing the cookie if the visitor has none. */
export function ensureAnonId(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): string {
  if (req.auth.anonId) return req.auth.anonId;
  const token = randomToken(24);
  reply.setCookie(ANON_COOKIE, token, cookieOptions(ctx, 7 * 24 * 3600));
  const id = sha256Hex(`anon:${token}`);
  req.auth = { ...req.auth, anonId: id };
  return id;
}
