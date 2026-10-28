import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => (t = await makeTestApp()));
afterAll(() => t.close());

describe('GET /v1/health', () => {
  it('reports db and redis status and the active modes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ db: 'ok', redis: 'ok' });
    expect(body.modes.slicer).toBe('estimate');
  });

  it('sets X-Request-Id and security headers on every response', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('echoes a well-formed incoming request id', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health', headers: { 'x-request-id': 'abcDEF123456' } });
    expect(res.headers['x-request-id']).toBe('abcDEF123456');
  });

  it('returns the error envelope on unknown routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.request_id).toBe(res.headers['x-request-id']);
  });
});
