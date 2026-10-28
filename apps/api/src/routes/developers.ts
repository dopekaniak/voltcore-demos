import type { FastifyInstance } from 'fastify';
import { AppError, authApi, fromApiId, toApiId } from '@sw/shared';
import { encrypt, randomToken, sha256Hex } from '@sw/shared/node';
import { audit, enqueue } from '@sw/db';
import type { AppContext } from '../context';
import { route } from '../lib/route';
import { serializeApiKey, serializeWebhook } from '../lib/serialize';
import { API_KEY_PREFIX } from '../plugins/auth';

export function developerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const scopeOf = (userId: string) => ({ userId });

  route(app, ctx, authApi.listApiKeys, async (_i, req) => {
    const keys = await ctx.repos.apiKeys.list(scopeOf(req.auth.userId!));
    return { data: keys.map(serializeApiKey) };
  });

  route(app, ctx, authApi.createApiKey, async ({ body }, req) => {
    const prefix = randomToken(6).replace(/[-_]/g, 'x').slice(0, 8);
    const key = `${API_KEY_PREFIX}${prefix}_${randomToken(24)}`;
    const row = await ctx.repos.apiKeys.create(scopeOf(req.auth.userId!), { name: body.name, prefix, keyHash: sha256Hex(key), scopes: [...new Set(body.scopes)] });
    await audit(ctx.db, { actorId: req.auth.userId, action: 'api_key.create', targetType: 'api_key', targetId: row.id, data: { scopes: row.scopes }, requestId: req.id });
    return { ...serializeApiKey(row), key };
  });

  route(app, ctx, authApi.deleteApiKey, async ({ params }, req) => {
    const id = fromApiId('apiKey', params.id);
    if (!id || !(await ctx.repos.apiKeys.revoke(scopeOf(req.auth.userId!), id))) throw new AppError('NOT_FOUND', 'API key not found');
    await audit(ctx.db, { actorId: req.auth.userId, action: 'api_key.revoke', targetType: 'api_key', targetId: id, requestId: req.id });
    return { ok: true as const };
  });

  route(app, ctx, authApi.listWebhooks, async (_i, req) => ({
    data: (await ctx.repos.webhooks.list(scopeOf(req.auth.userId!))).map(serializeWebhook),
  }));

  route(app, ctx, authApi.createWebhook, async ({ body }, req) => {
    const secret = `whsec_${randomToken(24)}`;
    const row = await ctx.repos.webhooks.create(scopeOf(req.auth.userId!), {
      url: body.url,
      events: [...new Set(body.events)],
      secretEnc: encrypt(ctx.env.APP_SECRET, 'webhook', secret),
    });
    return { ...serializeWebhook(row), secret };
  });

  route(app, ctx, authApi.patchWebhook, async ({ params, body }, req) => {
    const id = fromApiId('webhook', params.id);
    const row = id
      ? await ctx.repos.webhooks.update(scopeOf(req.auth.userId!), id, {
          ...(body.url ? { url: body.url } : {}),
          ...(body.events ? { events: body.events } : {}),
          ...(body.status ? { status: body.status } : {}),
        })
      : null;
    if (!row) throw new AppError('NOT_FOUND', 'Webhook not found');
    return serializeWebhook(row);
  });

  route(app, ctx, authApi.deleteWebhook, async ({ params }, req) => {
    const id = fromApiId('webhook', params.id);
    if (!id || !(await ctx.repos.webhooks.remove(scopeOf(req.auth.userId!), id))) throw new AppError('NOT_FOUND', 'Webhook not found');
    return { ok: true as const };
  });

  route(app, ctx, authApi.testWebhook, async ({ params }, req) => {
    const id = fromApiId('webhook', params.id);
    const delivery = id
      ? await ctx.repos.webhooks.createDelivery(scopeOf(req.auth.userId!), id, 'webhook.test', {
          type: 'webhook.test',
          created: Math.floor(ctx.now().getTime() / 1000),
          data: { message: 'Test event from Shapewright' },
        })
      : null;
    if (!delivery) throw new AppError('NOT_FOUND', 'Webhook not found');
    await enqueue(ctx.db, 'webhook-delivery', delivery.id, { deliveryId: delivery.id });
    return { delivery_id: toApiId('event', delivery.id) };
  });
}
