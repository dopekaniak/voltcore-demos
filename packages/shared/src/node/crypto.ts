import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret: string | Buffer, input: string | Buffer): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Derive a purpose-specific key from APP_SECRET. */
export function deriveKey(appSecret: string, purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'shapewright', purpose, length));
}

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(appSecret: string, purpose: string, plaintext: string): string {
  const key = deriveKey(appSecret, purpose);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(appSecret: string, purpose: string, payload: string): string {
  const buf = Buffer.from(payload, 'base64url');
  const key = deriveKey(appSecret, purpose);
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// ── TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ──

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretB32: string, atMs: number, stepS = 30): string {
  const counter = Math.floor(atMs / 1000 / stepS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Accepts the current step and one step either side for clock drift. */
export function verifyTotp(secretB32: string, code: string, atMs: number): boolean {
  return [-1, 0, 1].some((w) => safeEqual(totpCode(secretB32, atMs + w * 30_000), code));
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Stripe-style signature header: `t=<unix>,v1=<hmac(t.payload)>`. */
export function signPayload(secret: string, payload: string, tSeconds: number): string {
  return `t=${tSeconds},v1=${hmacHex(secret, `${tSeconds}.${payload}`)}`;
}

export function verifySignedPayload(
  secret: string,
  payload: string | Buffer,
  header: string | undefined,
  nowSeconds: number,
  toleranceS = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceS) return false;
  const sigs = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  const expected = hmacHex(secret, Buffer.concat([Buffer.from(`${t}.`), Buffer.from(payload)]));
  return sigs.some((s) => safeEqual(s, expected));
}
