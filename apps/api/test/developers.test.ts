import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, bearer, makeTestApp, signIn } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => (t = await makeTestApp()));
afterAll(() => t.close());

describe('API keys and scopes', () => {
  it('creates a key once, stores a hash, and authenticates with it', async () => {
    const s = await signIn(t);
    const res = await as(t, s.cookie)('POST', '/v1/api-keys', { name: 'ci', scopes: ['billing:read', 'forge:read'] });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^sw_live_/);
    const stored = await t.ctx.db.apiKey.findFirstOrThrow({ where: { prefix: body.prefix } });
    expect(stored.keyHash).not.toContain(body.key);
    const listed = await as(t, s.cookie)('GET', '/v1/api-keys');
    expect(JSON.stringify(listed.json())).not.toContain(body.key);
    const wallet = await bearer(t, body.key)('GET', '/v1/billing/wallet');
    expect(wallet.statusCode).toBe(200);
  });

  it('J8: a key without the billing scope gets 403 INSUFFICIENT_SCOPE on billing routes', async () => {
    const s = await signIn(t);
    const { key } = (await as(t, s.cookie)('POST', '/v1/api-keys', { name: 'no-billing', scopes: ['forge:read'] })).json();
    for (const url of ['/v1/billing/wallet', '/v1/billing/ledger']) {
      const res = await bearer(t, key)('GET', url);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('INSUFFICIENT_SCOPE');
    }
  });

  it('cannot manage keys with an API key, and revoked keys stop working', async () => {
    const s = await signIn(t);
    const created = (await as(t, s.cookie)('POST', '/v1/api-keys', { name: 'x', scopes: ['billing:read'] })).json();
    expect((await bearer(t, created.key)('GET', '/v1/api-keys')).statusCode).toBe(403);
    expect((await as(t, s.cookie)('DELETE', `/v1/api-keys/${created.id}`)).statusCode).toBe(200);
    expect((await bearer(t, created.key)('GET', '/v1/billing/wallet')).statusCode).toBe(401);
  });

  it('rejects unknown scopes', async () => {
    const s = await signIn(t);
    expect((await as(t, s.cookie)('POST', '/v1/api-keys', { name: 'x', scopes: ['admin:all'] })).statusCode).toBe(400);
  });
});

describe('webhook endpoints', () => {
  it('creates, updates, tests, and deletes an endpoint', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const created = await call('POST', '/v1/webhooks', { url: 'https://example.test/hook', events: ['job.succeeded'] });
    expect(created.statusCode).toBe(201);
    const wh = created.json();
    expect(wh.secret).toMatch(/^whsec_/);
    const patched = await call('PATCH', `/v1/webhooks/${wh.id}`, { events: ['order.paid'], status: 'DISABLED' });
    expect(patched.json()).toMatchObject({ events: ['order.paid'], status: 'DISABLED' });
    const test = await call('POST', `/v1/webhooks/${wh.id}/test`);
    expect(test.statusCode).toBe(202);
    expect((await call('DELETE', `/v1/webhooks/${wh.id}`)).statusCode).toBe(200);
    expect((await call('GET', '/v1/webhooks')).json().data).toEqual([]);
  });

  it('refuses plain http URLs except localhost', async () => {
    const s = await signIn(t);
    expect((await as(t, s.cookie)('POST', '/v1/webhooks', { url: 'http://example.test/x', events: ['job.failed'] })).statusCode).toBe(400);
  });
});

describe('ledger', () => {
  it('lists newest first with cursor pagination', async () => {
    const s = await signIn(t);
    const page = await as(t, s.cookie)('GET', '/v1/billing/ledger?limit=1');
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ kind: 'GRANT', delta: 100, balance_after: 100 });
    expect(body.next_cursor).toBeNull();
  });
});
