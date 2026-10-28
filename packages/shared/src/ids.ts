import { v7 as uuidv7 } from 'uuid';

/** API ID prefixes (ADR-014). Database columns hold plain UUIDv7 values. */
export const ID_PREFIX = {
  user: 'usr_',
  asset: 'ast_',
  forge: 'frg_',
  version: 'ver_',
  file: 'fil_',
  job: 'job_',
  part: 'prt_',
  quote: 'qte_',
  order: 'ord_',
  orderItem: 'oit_',
  apiKey: 'key_',
  webhook: 'whk_',
  upload: 'upl_',
  cart: 'crt_',
  cartItem: 'cit_',
  address: 'adr_',
  refund: 'rfd_',
  event: 'evt_',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;

export function newId(): string {
  return uuidv7();
}

/** Render a database UUID as a prefixed API ID. */
export function toApiId(kind: IdKind, uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`not a uuid: ${uuid}`);
  return ID_PREFIX[kind] + uuid.replace(/-/g, '');
}

/**
 * Parse a prefixed API ID back to a UUID. Returns null for a wrong prefix or a malformed
 * value; callers turn null into 404 so IDs of other types never leak information.
 */
export function fromApiId(kind: IdKind, apiId: string): string | null {
  const prefix = ID_PREFIX[kind];
  if (typeof apiId !== 'string' || !apiId.startsWith(prefix)) return null;
  const hex = apiId.slice(prefix.length).toLowerCase();
  if (!HEX32_RE.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
