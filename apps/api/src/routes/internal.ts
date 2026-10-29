import type { FastifyInstance } from 'fastify';
import { AppError } from '@sw/shared';
import { enqueue, isUniqueViolation } from '@sw/db';
import type { AppContext } from '../context';

/**
 * Provider webhooks (signature-checked, no cookies). The body is stored raw and deduped on
 * the provider's event key. State changes happen in the worker, which fetches the task
 * from the provider before moving the job (ADR-006), so an unsigned or replayed body can
 * never set a status by itself.
 */
export function internalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/internal/providers/:key/webhook', { config: { rateLimit: false } }, async (req, reply) => {
      const { key } = req.params as { key: string };
      const provider = ctx.providers.get(key);
      if (!provider) throw new AppError('NOT_FOUND', 'Unknown provider');
      const raw = req.body as Buffer;
      const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])));
      const verified = provider.verifyWebhook(headers, raw);
      // Providers with a signing scheme must pass it; the others are accepted but untrusted.
      if (!verified && provider.key === 'mock') throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature check failed');
      const parsed = provider.parseWebhook(headers, raw);
      if (!parsed) throw new AppError('VALIDATION_FAILED', 'Unrecognized webhook body');
      try {
        await ctx.db.providerEventRaw.create({
          data: { providerKey: key, eventKey: parsed.eventKey, headers: Object.fromEntries(headers.entries()), body: raw.toString('utf8').slice(0, 100_000) },
        });
      } catch (e) {
        if (isUniqueViolation(e)) return reply.status(200).send({ received: true, duplicate: true });
        throw e;
      }
      const job = await ctx.db.job.findFirst({ where: { providerKey: key, providerTaskId: parsed.task.id } });
      if (job) await enqueue(ctx.db, 'generation', `${job.id}:wh:${parsed.eventKey}`, { jobId: job.id, poll: true, trusted: verified });
      return reply.status(200).send({ received: true, duplicate: false, matched: Boolean(job) });
    });
  });
}
