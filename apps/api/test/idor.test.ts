import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => (t = await makeTestApp()));
afterAll(() => t.close());

/**
 * User A cannot read or change user B's resources. Each slice adds its resource types here
 * (forge, asset, job, quote, cart, order).
 */
describe('IDOR: API keys and webhooks', () => {
  it('user A cannot see, revoke, change, or test user B\'s key or webhook', async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const key = (await as(t, b.cookie)('POST', '/v1/api-keys', { name: 'b', scopes: ['forge:read'] })).json();
    const wh = (await as(t, b.cookie)('POST', '/v1/webhooks', { url: 'https://b.example.test', events: ['job.failed'] })).json();
    const callA = as(t, a.cookie);
    expect((await callA('GET', '/v1/api-keys')).json().data).toEqual([]);
    expect((await callA('DELETE', `/v1/api-keys/${key.id}`)).statusCode).toBe(404);
    expect((await callA('GET', '/v1/webhooks')).json().data).toEqual([]);
    expect((await callA('PATCH', `/v1/webhooks/${wh.id}`, { status: 'DISABLED' })).statusCode).toBe(404);
    expect((await callA('POST', `/v1/webhooks/${wh.id}/test`)).statusCode).toBe(404);
    expect((await callA('DELETE', `/v1/webhooks/${wh.id}`)).statusCode).toBe(404);
    // B's resources are untouched
    expect((await as(t, b.cookie)('GET', '/v1/webhooks')).json().data[0].status).toBe('ACTIVE');
  });
});
