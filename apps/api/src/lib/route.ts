import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError, type RouteDef } from '@sw/shared';
import { sha256Hex } from '@sw/shared/node';
import { isUniqueViolation, type Prisma } from '@sw/db';
import type { AppContext } from '../context';

type Infer<T> = NonNullable<T> extends z.ZodType ? z.infer<NonNullable<T>> : undefined;

export interface RouteInput<D extends RouteDef> {
  body: Infer<D['body']>;
  query: Infer<D['query']>;
  params: Infer<D['params']>;
  idempotencyKey: string | null;
}

export type Handler<D extends RouteDef> = (
  input: RouteInput<D>,
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function requireUser(req: FastifyRequest): string {
  if (!req.auth.userId) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  return req.auth.userId;
}

function enforceAuth(def: RouteDef, req: FastifyRequest): void {
  const a = req.auth;
  switch (def.auth) {
    case 'none':
    case 'optional':
    case 'internal':
      return;
    case 'user':
      requireUser(req);
      if (a.kind === 'apikey' && def.scope && !a.scopes?.has(def.scope)) {
        throw new AppError('INSUFFICIENT_SCOPE', `API key lacks the ${def.scope} scope`, { required: def.scope });
      }
      return;
    case 'session':
      if (a.kind !== 'session') {
        throw a.kind === 'apikey'
          ? new AppError('FORBIDDEN', 'This route needs a browser session, not an API key')
          : new AppError('UNAUTHENTICATED', 'Sign in required');
      }
      return;
    case 'admin':
      if (a.kind !== 'session') throw new AppError(a.kind === 'apikey' ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'Admin session required');
      if (a.role !== 'ADMIN' && a.role !== 'OPS') throw new AppError('FORBIDDEN', 'Admin role required');
      if (!a.totpEnabled || !a.totpVerified) throw new AppError('TOTP_REQUIRED', 'Verify TOTP for this session first');
      return;
  }
}

function enforceOrigin(ctx: AppContext, def: RouteDef, req: FastifyRequest): void {
  if (!MUTATING.has(def.method) || def.auth === 'internal' || req.auth.kind === 'apikey') return;
  const usesCookie = Boolean(req.headers.cookie);
  if (!usesCookie) return;
  const origin = req.headers.origin;
  const allowed = [ctx.env.WEB_ORIGIN, ctx.env.API_ORIGIN];
  if (!origin || !allowed.includes(origin)) {
    throw new AppError('ORIGIN_MISMATCH', 'Cross-site request refused');
  }
}

function idempotencyKeyOf(req: FastifyRequest): string | null {
  const v = req.headers['idempotency-key'];
  if (typeof v !== 'string') return null;
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(v)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key must be 8-200 URL-safe characters');
  return v;
}

/** Register a route from its shared definition: auth, origin, validation, idempotency. */
export function route<D extends RouteDef>(app: FastifyInstance, ctx: AppContext, def: D, handler: Handler<D>): void {
  app.route({
    method: def.method,
    url: def.path,
    handler: async (req, reply) => {
      enforceAuth(def, req);
      enforceOrigin(ctx, def, req);
      const input = {
        body: def.body ? def.body.parse(req.body ?? {}) : undefined,
        query: def.query ? def.query.parse(req.query ?? {}) : undefined,
        params: def.params ? def.params.parse(req.params ?? {}) : undefined,
        idempotencyKey: idempotencyKeyOf(req),
      } as RouteInput<D>;
      if (def.idempotent && !input.idempotencyKey) {
        throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      // Replay a stored response for a repeated idempotency key.
      let scope: string | null = null;
      let requestHash = '';
      if (def.idempotent && input.idempotencyKey) {
        const who = req.auth.userId ?? req.auth.anonId ?? `ip:${req.ip}`;
        scope = `${who}:${def.method}:${def.path}`;
        requestHash = sha256Hex(JSON.stringify({ b: input.body ?? null, p: input.params ?? null }));
        const prior = await ctx.db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.idempotencyKey } } });
        if (prior) {
          if (prior.requestHash !== requestHash) {
            throw new AppError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used with a different request');
          }
          reply.header('Idempotent-Replayed', 'true');
          return reply.status(prior.responseStatus).send(prior.responseBody);
        }
      }

      const result = await handler(input, req, reply);
      if (reply.sent || def.sse) return reply;
      const status = def.status ?? 200;
      if (ctx.env.NODE_ENV === 'test' && def.response && result !== undefined) {
        const check = def.response.safeParse(result);
        if (!check.success) {
          throw new Error(`response for ${def.method} ${def.path} does not match its schema: ${check.error.message}`);
        }
      }
      if (scope && input.idempotencyKey) {
        await ctx.db.idempotencyRecord
          .create({ data: { scope, key: input.idempotencyKey, requestHash, responseStatus: status, responseBody: (result ?? null) as Prisma.InputJsonValue } })
          .catch((e: unknown) => {
            if (!isUniqueViolation(e)) throw e;
          });
      }
      return reply.status(status).send(result);
    },
  });
}

/** Opaque cursor over UUIDv7 ids (they sort by creation time). */
export function encodeCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}
export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'invalid cursor');
  return id;
}
export function pageOf<T, R>(rows: T[], limit: number, idOf: (r: T) => string, map: (r: T) => R): { data: R[]; next_cursor: string | null } {
  const data = rows.slice(0, limit).map(map);
  const last = rows[limit - 1];
  return { data, next_cursor: rows.length > limit && last ? encodeCursor(idOf(last)) : null };
}
