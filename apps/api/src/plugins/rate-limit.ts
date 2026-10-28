import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';

/**
 * 60/min for signed-in users (RATE_LIMIT_USER_PER_MIN), API keys by plan, anonymous by IP.
 * Responses over the limit are 429 with Retry-After.
 */
export async function rateLimits(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    timeWindow: 60_000,
    redis: ctx.redis,
    nameSpace: ctx.rateLimitNamespace ?? 'sw-rl:',
    max: (req: FastifyRequest) => {
      if (req.auth?.kind === 'apikey') return req.auth.apiRateLimit;
      if (req.auth?.userId) return ctx.env.RATE_LIMIT_USER_PER_MIN;
      return ctx.env.RATE_LIMIT_USER_PER_MIN * 2;
    },
    keyGenerator: (req: FastifyRequest) => {
      if (req.auth?.apiKeyId) return `key:${req.auth.apiKeyId}`;
      if (req.auth?.userId) return `user:${req.auth.userId}`;
      return `ip:${req.ip}`;
    },
    allowList: (req: FastifyRequest) => req.url.startsWith('/internal/') || req.url === '/v1/health',
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
    addHeaders: { 'retry-after': true, 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
  });
}
