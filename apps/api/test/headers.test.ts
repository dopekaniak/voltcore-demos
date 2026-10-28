import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, scrubSecrets } from '../src/lib/redact';

describe('log redaction', () => {
  it('redacts auth headers, cookies, signatures, and keys', () => {
    for (const p of ['req.headers.authorization', 'req.headers.cookie', 'req.headers["stripe-signature"]', 'res.headers["set-cookie"]']) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
  it('scrubs secrets from free text', () => {
    expect(scrubSecrets('key sk_test_abc123 and sw_live_ab12_cd34 and whsec_x1')).toBe('key [REDACTED] and [REDACTED] and [REDACTED]');
  });
});
