import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decrypt, encrypt, signPayload, totpCode, verifySignedPayload, verifyTotp } from '../src/node/crypto';

describe('node crypto helpers', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // RFC 6238 Appendix B: T=59 → 94287082 (8 digits); 6-digit form is 287082
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(totpCode(secret, 1111111109_000)).toBe('081804');
    expect(verifyTotp(secret, '287082', 59_000 + 25_000)).toBe(true);
    expect(verifyTotp(secret, '000000', 59_000)).toBe(false);
  });
  it('round-trips base32', () => {
    const b = Buffer.from([1, 2, 3, 250, 99]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });
  it('encrypts and decrypts, and rejects tampering', () => {
    const s = 'x'.repeat(40);
    const c = encrypt(s, 'totp', 'hello');
    expect(decrypt(s, 'totp', c)).toBe('hello');
    expect(() => decrypt(s, 'other', c)).toThrow();
  });
  it('verifies signed payloads within tolerance', () => {
    const h = signPayload('whsec', '{"a":1}', 1000);
    expect(verifySignedPayload('whsec', '{"a":1}', h, 1100)).toBe(true);
    expect(verifySignedPayload('whsec', '{"a":2}', h, 1100)).toBe(false);
    expect(verifySignedPayload('whsec', '{"a":1}', h, 2000)).toBe(false);
    expect(verifySignedPayload('whsec', '{"a":1}', undefined, 1000)).toBe(false);
  });
});
