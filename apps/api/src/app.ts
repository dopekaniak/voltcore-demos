import Fastify, { type FastifyInstance } from 'fastify';
import { newId } from '@sw/shared';
import type { AppContext } from './context';
import { REDACT_PATHS } from './lib/redact';
import { errorHandling } from './plugins/errors';
import { securityHeaders } from './plugins/security-headers';
import { healthRoutes } from './routes/health';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      ctx.env.LOG_LEVEL === 'silent' || ctx.env.NODE_ENV === 'test'
        ? false
        : { level: ctx.env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : `req_${newId().replace(/-/g, '')}`;
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  securityHeaders(app, { production: ctx.env.NODE_ENV === 'production' });
  errorHandling(app);
  healthRoutes(app, ctx);
  return app;
}
