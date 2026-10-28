import { z } from 'zod';
import { defineRoute, idParam, okResponse, page, cursorQuery, SCOPES } from './route';

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN', 'OPS']),
  terms_version: z.string().nullable(),
  totp_enabled: z.boolean(),
  plan: z.string(),
  created_at: z.string(),
});

export const magicLinkRequest = defineRoute({
  method: 'POST',
  path: '/v1/auth/magic-link',
  summary: 'Email a single-use sign-in link (always 202)',
  tag: 'auth',
  auth: 'optional',
  status: 202,
  body: z.object({ email: z.string().email().max(254), redirect_to: z.string().max(500).regex(/^\/(?!\/)/, 'must be a same-site path').optional() }),
  response: z.object({ ok: z.literal(true) }),
});

export const magicLinkConsume = defineRoute({
  method: 'POST',
  path: '/v1/auth/magic-link/consume',
  summary: 'Exchange a magic-link token for a session cookie',
  tag: 'auth',
  auth: 'optional',
  body: z.object({ token: z.string().min(20).max(200) }),
  response: z.object({ user: userSchema, redirect_to: z.string().nullable(), claimed: z.number().int() }),
});

export const logout = defineRoute({
  method: 'POST',
  path: '/v1/auth/logout',
  summary: 'Revoke the current session',
  tag: 'auth',
  auth: 'session',
  response: okResponse,
});

export const totpSetup = defineRoute({
  method: 'POST',
  path: '/v1/auth/totp/setup',
  summary: 'Start TOTP enrollment; returns the otpauth URI',
  tag: 'auth',
  auth: 'session',
  response: z.object({ otpauth_url: z.string(), secret: z.string() }),
});

export const totpVerify = defineRoute({
  method: 'POST',
  path: '/v1/auth/totp/verify',
  summary: 'Verify a TOTP code; enables TOTP and marks this session verified',
  tag: 'auth',
  auth: 'session',
  body: z.object({ code: z.string().regex(/^\d{6}$/) }),
  response: okResponse,
});

export const getMe = defineRoute({
  method: 'GET',
  path: '/v1/me',
  summary: 'The signed-in user',
  tag: 'account',
  auth: 'user',
  response: userSchema,
});

export const patchMe = defineRoute({
  method: 'PATCH',
  path: '/v1/me',
  summary: 'Update name or accept the current terms',
  tag: 'account',
  auth: 'session',
  body: z.object({ name: z.string().min(1).max(100).optional(), accept_terms_version: z.string().max(50).optional() }),
  response: userSchema,
});

const scopeEnum = z.enum(SCOPES);
export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(scopeEnum),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});

export const listApiKeys = defineRoute({ method: 'GET', path: '/v1/api-keys', summary: 'List API keys', tag: 'developers', auth: 'session', response: z.object({ data: z.array(apiKeySchema) }) });
export const createApiKey = defineRoute({
  method: 'POST',
  path: '/v1/api-keys',
  summary: 'Create an API key (the secret is shown once)',
  tag: 'developers',
  auth: 'session',
  status: 201,
  body: z.object({ name: z.string().min(1).max(100), scopes: z.array(scopeEnum).min(1) }),
  response: apiKeySchema.extend({ key: z.string() }),
});
export const deleteApiKey = defineRoute({ method: 'DELETE', path: '/v1/api-keys/:id', summary: 'Revoke an API key', tag: 'developers', auth: 'session', params: idParam, response: okResponse });

export const WEBHOOK_EVENTS = ['job.succeeded', 'job.failed', 'order.paid', 'order.shipped', 'order.delivered', 'webhook.test'] as const;
export const webhookSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  status: z.enum(['ACTIVE', 'DISABLED']),
  created_at: z.string(),
});
const webhookUrl = z.string().url().max(500).refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'must be https');
export const listWebhooks = defineRoute({ method: 'GET', path: '/v1/webhooks', summary: 'List webhook endpoints', tag: 'developers', auth: 'user', scope: 'webhooks:read', response: z.object({ data: z.array(webhookSchema) }) });
export const createWebhook = defineRoute({
  method: 'POST',
  path: '/v1/webhooks',
  summary: 'Create a webhook endpoint (the signing secret is shown once)',
  tag: 'developers',
  auth: 'user',
  scope: 'webhooks:write',
  status: 201,
  body: z.object({ url: webhookUrl, events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }),
  response: webhookSchema.extend({ secret: z.string() }),
});
export const patchWebhook = defineRoute({
  method: 'PATCH',
  path: '/v1/webhooks/:id',
  summary: 'Update a webhook endpoint',
  tag: 'developers',
  auth: 'user',
  scope: 'webhooks:write',
  params: idParam,
  body: z.object({ url: webhookUrl.optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }),
  response: webhookSchema,
});
export const deleteWebhook = defineRoute({ method: 'DELETE', path: '/v1/webhooks/:id', summary: 'Delete a webhook endpoint', tag: 'developers', auth: 'user', scope: 'webhooks:write', params: idParam, response: okResponse });
export const testWebhook = defineRoute({
  method: 'POST',
  path: '/v1/webhooks/:id/test',
  summary: 'Send a signed test event',
  tag: 'developers',
  auth: 'user',
  scope: 'webhooks:write',
  params: idParam,
  status: 202,
  response: z.object({ delivery_id: z.string() }),
});

export const walletSchema = z.object({
  balance: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  expiring: z.array(z.object({ amount: z.number().int(), expires_at: z.string() })),
  plan: z.string(),
});
export const ledgerEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  delta: z.number().int(),
  reserved_delta: z.number().int(),
  balance_after: z.number().int(),
  reason: z.string().nullable(),
  job_id: z.string().nullable(),
  created_at: z.string(),
});
export const getWallet = defineRoute({ method: 'GET', path: '/v1/billing/wallet', summary: 'Credit balance', tag: 'billing', auth: 'user', scope: 'billing:read', response: walletSchema });
export const getLedger = defineRoute({ method: 'GET', path: '/v1/billing/ledger', summary: 'Credit ledger (newest first)', tag: 'billing', auth: 'user', scope: 'billing:read', query: cursorQuery, response: page(ledgerEntrySchema) });
