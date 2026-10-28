import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, sha256Hex, totpCode } from '@sw/shared/node';
import { as, makeTestApp, ORIGIN, signIn } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => (t = await makeTestApp()));
afterAll(() => t.close());

describe('magic link sign-in', () => {
  it('signs in, creates a wallet with free credits, and returns the user', async () => {
    const s = await signIn(t);
    expect(s.user.id).toMatch(/^usr_/);
    expect(s.user.plan).toBe('free');
    const me = await as(t, s.cookie)('GET', '/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(s.email);
    const w = await as(t, s.cookie)('GET', '/v1/billing/wallet');
    expect(w.json()).toMatchObject({ balance: 100, reserved: 0, available: 100 });
  });

  it('answers 202 for any email and never reveals whether it exists', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link', headers: { origin: ORIGIN }, payload: { email: 'nobody@example.test' } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
  });

  it('is single-use', async () => {
    const s = await signIn(t);
    const again = await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link/consume', headers: { origin: ORIGIN }, payload: { token: s.token } });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('expires after 15 minutes', async () => {
    const email = `exp-${crypto.randomUUID()}@example.test`;
    await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link', headers: { origin: ORIGIN }, payload: { email } });
    const ml = await t.ctx.db.magicLink.findFirstOrThrow({ where: { email } });
    expect(ml.expiresAt.getTime() - ml.createdAt.getTime()).toBeLessThanOrEqual(15 * 60_000 + 1000);
    await t.ctx.db.magicLink.update({ where: { id: ml.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const msg = await t.ctx.db.outboxMessage.findFirstOrThrow({ where: { key: `magic-link:${ml.id}` } });
    const token = new URL((msg.payload as { vars: { url: string } }).vars.url).searchParams.get('token')!;
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link/consume', headers: { origin: ORIGIN }, payload: { token } });
    expect(res.json().error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('stores only a hash of the token', async () => {
    const s = await signIn(t);
    expect(await t.ctx.db.magicLink.findUnique({ where: { tokenHash: sha256Hex(s.token) } })).not.toBeNull();
    expect(await t.ctx.db.magicLink.count({ where: { tokenHash: s.token } })).toBe(0);
  });

  it('rotates the session on login', async () => {
    const first = await signIn(t);
    const second = await signIn(t, first.email, first.cookie);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await as(t, first.cookie)('GET', '/v1/me')).statusCode).toBe(401);
    expect((await as(t, second.cookie)('GET', '/v1/me')).statusCode).toBe(200);
  });

  it('logs out', async () => {
    const s = await signIn(t);
    expect((await as(t, s.cookie)('POST', '/v1/auth/logout')).statusCode).toBe(200);
    expect((await as(t, s.cookie)('GET', '/v1/me')).statusCode).toBe(401);
  });

  it('rejects open redirects', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link', headers: { origin: ORIGIN }, payload: { email: 'a@example.test', redirect_to: '//evil.example' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('cross-site protection', () => {
  it('refuses cookie-authenticated mutations from another origin', async () => {
    const s = await signIn(t);
    const res = await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: { cookie: s.cookie, origin: 'https://evil.example' }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ORIGIN_MISMATCH');
    const noOrigin = await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: { cookie: s.cookie }, payload: { name: 'x' } });
    expect(noOrigin.json().error.code).toBe('ORIGIN_MISMATCH');
  });
});

describe('TOTP', () => {
  it('enrolls, verifies, and marks the session', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const setup = await call('POST', '/v1/auth/totp/setup');
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json();
    expect(base32Decode(secret)).toHaveLength(20);
    expect((await call('POST', '/v1/auth/totp/verify', { code: '000000' })).json().error.code).toMatch(/TOTP_INVALID/);
    const ok = await call('POST', '/v1/auth/totp/verify', { code: totpCode(secret, Date.now()) });
    expect(ok.statusCode).toBe(200);
    const me = await call('GET', '/v1/me');
    expect(me.json().totp_enabled).toBe(true);
  });
});

describe('terms', () => {
  it('accepts only the current terms version', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    expect((await call('PATCH', '/v1/me', { accept_terms_version: 'old' })).statusCode).toBe(400);
    const ok = await call('PATCH', '/v1/me', { accept_terms_version: t.ctx.env.TERMS_VERSION, name: 'Ada' });
    expect(ok.json()).toMatchObject({ terms_version: t.ctx.env.TERMS_VERSION, name: 'Ada' });
  });
});
