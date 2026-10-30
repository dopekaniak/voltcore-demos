import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { newId } from '@sw/shared';
import type { AppContext } from './context';
import { REDACT_PATHS } from './lib/redact';
import { authPlugin } from './plugins/auth';
import { errorHandling } from './plugins/errors';
import { rateLimits } from './plugins/rate-limit';
import { securityHeaders } from './plugins/security-headers';
import { assetRoutes } from './routes/assets';
import { authRoutes } from './routes/auth';
import { cartRoutes } from './routes/cart';
import { catalogRoutes } from './routes/catalog';
import { customizerRoutes } from './routes/customizers';
import { printRoutes } from './routes/print';
import { generateRoutes } from './routes/generate';
import { internalRoutes } from './routes/internal';
import { libraryRoutes } from './routes/library';
import { uploadRoutes } from './routes/uploads';
import { billingRoutes } from './routes/billing';
import { developerRoutes } from './routes/developers';
import { fileRoutes } from './routes/files';
import { forgeRoutes } from './routes/forges';
import { jobRoutes } from './routes/jobs';
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
  await app.register(cookie);
  authPlugin(app, ctx);
  await rateLimits(app, ctx);
  healthRoutes(app, ctx);
  authRoutes(app, ctx);
  developerRoutes(app, ctx);
  billingRoutes(app, ctx);
  forgeRoutes(app, ctx);
  jobRoutes(app, ctx);
  fileRoutes(app, ctx);
  assetRoutes(app, ctx);
  generateRoutes(app, ctx);
  libraryRoutes(app, ctx);
  uploadRoutes(app, ctx);
  internalRoutes(app, ctx);
  printRoutes(app, ctx);
  cartRoutes(app, ctx);
  catalogRoutes(app, ctx);
  customizerRoutes(app, ctx);
  return app;
}
