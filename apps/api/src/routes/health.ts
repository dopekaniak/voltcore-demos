import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

export function healthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/health', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, 'ok' | 'down'> = { db: 'down', redis: 'down' };
    await Promise.all([
      ctx.db.$queryRaw`SELECT 1`.then(() => (checks.db = 'ok')).catch(() => undefined),
      ctx.redis.ping().then(() => (checks.redis = 'ok')).catch(() => undefined),
    ]);
    const ok = Object.values(checks).every((v) => v === 'ok');
    reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      version: ctx.version,
      checks,
      modes: {
        provider: ctx.env.PROVIDER_MODE,
        forge_author: ctx.env.FORGE_AUTHOR,
        slicer: ctx.env.SLICER_MODE,
        payments: ctx.env.PAYMENTS_MODE,
        partner: ctx.env.PARTNER_MODE,
      },
    });
  });
}
