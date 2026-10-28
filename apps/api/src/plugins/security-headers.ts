import type { FastifyInstance } from 'fastify';

/** Security headers on every API response (docs/security.md). */
export function securityHeaders(app: FastifyInstance, opts: { production: boolean }): void {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Request-Id', req.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    if (opts.production) reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    return payload;
  });
}
