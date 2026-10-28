import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => (t = await makeTestApp({ RATE_LIMIT_USER_PER_MIN: 5 })));
afterAll(() => t.close());

describe('rate limits', () => {
  it('returns 429 with Retry-After past the per-user limit', async () => {
    const s = await signIn(t);
    const call = as(t, s.cookie);
    const codes: number[] = [];
    let last;
    for (let i = 0; i < 7; i++) {
      last = await call('GET', '/v1/me');
      codes.push(last.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    expect(last!.json().error.code).toBe('RATE_LIMITED');
  });
});
