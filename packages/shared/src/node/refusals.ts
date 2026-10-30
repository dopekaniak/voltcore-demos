import { hmacHex } from './crypto';

/** Keyed hash of a user (or anonymous visitor) for refusal logs: stable for review, not reversible. */
export function refusalUserHash(appSecret: string, who: string | null): string {
  return who ? hmacHex(appSecret, `refusal:${who}`).slice(0, 32) : 'anonymous';
}
