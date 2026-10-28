import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, errorEnvelope } from '@sw/shared';
import { scrubSecrets } from '../lib/redact';

/** Map every error to `{ error: { code, message, details, request_id } }`. */
export function errorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(errorEnvelope(new AppError('NOT_FOUND', 'Route not found'), req.id));
  });
  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof ZodError) {
      appErr = new AppError('VALIDATION_FAILED', 'Request validation failed', {
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    } else if ((err as FastifyError).statusCode === 429) {
      appErr = new AppError('RATE_LIMITED', 'Too many requests');
    } else if ((err as FastifyError).validation) {
      appErr = new AppError('VALIDATION_FAILED', err.message);
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      appErr = new AppError('VALIDATION_FAILED', err.message);
      (appErr as { status: number }).status = (err as FastifyError).statusCode!;
    } else {
      req.log.error({ err: { message: scrubSecrets(String(err.message)), stack: err.stack } }, 'unhandled error');
      appErr = new AppError('INTERNAL', 'Internal error');
    }
    if (appErr.status >= 500 && err instanceof AppError) req.log.warn({ code: appErr.code }, appErr.message);
    reply.status(appErr.status).send(errorEnvelope(appErr, req.id));
  });
}
