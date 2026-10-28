import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgresql://sw:sw@localhost:5432/shapewright',
  REDIS_URL: 'redis://localhost:6379',
  APP_SECRET: 'dev-0123456789abcdef0123456789abcdef',
};

describe('loadEnv', () => {
  it('boots with only the three required keys and safe defaults', () => {
    const env = loadEnv(base);
    expect(env.PROVIDER_MODE).toBe('mock');
    expect(env.SLICER_MODE).toBe('estimate');
    expect(env.PAYMENTS_MODE).toBe('mock');
    expect(env.ESTIMATE_ORDERS).toBe('block');
  });

  it('lists every missing key', () => {
    try {
      loadEnv({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as EnvError).problems.join('\n');
      expect(msg).toContain('DATABASE_URL: missing');
      expect(msg).toContain('REDIS_URL: missing');
      expect(msg).toContain('APP_SECRET: missing');
    }
  });

  it('refuses SLICER_MODE=real (rule 6)', () => {
    expect(() => loadEnv({ ...base, SLICER_MODE: 'real' })).toThrow(/ADR-002b/);
  });

  it('refuses allow-dev estimate orders in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), ESTIMATE_ORDERS: 'allow-dev', MESH_SERVICE_TOKEN: 'y'.repeat(20) }),
    ).toThrow(/ESTIMATE_ORDERS/);
  });

  it('requires Stripe test keys in stripe-test mode', () => {
    expect(() => loadEnv({ ...base, PAYMENTS_MODE: 'stripe-test' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      loadEnv({ ...base, PAYMENTS_MODE: 'stripe-test', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec' }),
    ).toThrow(/test-mode key/);
  });

  it('requires a provider key in live mode', () => {
    expect(() => loadEnv({ ...base, PROVIDER_MODE: 'live' })).toThrow(/MESHY_API_KEY/);
  });

  it('treats empty strings as unset', () => {
    expect(() => loadEnv({ ...base, APP_SECRET: '' })).toThrow(/APP_SECRET: missing/);
  });
});
