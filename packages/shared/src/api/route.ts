import { z } from 'zod';

export const SCOPES = [
  'forge:read',
  'forge:write',
  'generate:read',
  'generate:write',
  'assets:read',
  'assets:write',
  'print:read',
  'print:write',
  'orders:read',
  'orders:write',
  'billing:read',
  'billing:write',
  'webhooks:read',
  'webhooks:write',
] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * none: no auth. optional: anonymous visitors allowed (anon cookie). user: session or API
 * key. session: browser session only (no API keys). admin: ADMIN/OPS role with TOTP.
 * internal: signature-checked webhook, no cookies.
 */
export type RouteAuth = 'none' | 'optional' | 'user' | 'session' | 'admin' | 'internal';

export interface RouteDef<
  B extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  P extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  tag: string;
  auth: RouteAuth;
  scope?: Scope;
  idempotent?: boolean;
  body?: B;
  query?: Q;
  params?: P;
  response?: R;
  status?: number;
  sse?: boolean;
}

export const routes: RouteDef[] = [];

export function defineRoute<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType, R extends z.ZodType>(
  def: RouteDef<B, Q, P, R>,
): RouteDef<B, Q, P, R> {
  routes.push(def as unknown as RouteDef);
  return def;
}

export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function page<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), next_cursor: z.string().nullable() });
}

export const idParam = z.object({ id: z.string().min(4).max(64) });
export const okResponse = z.object({ ok: z.literal(true) });
