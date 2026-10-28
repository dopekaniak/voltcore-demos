import { toApiId } from '@sw/shared';
import type { ApiKey, CreditLedger, User, WebhookEndpoint } from '@sw/db';

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function serializeUser(u: User, plan: string) {
  return {
    id: toApiId('user', u.id),
    email: u.email,
    name: u.name,
    role: u.role,
    terms_version: u.termsVersion,
    totp_enabled: u.totpEnabledAt !== null,
    plan,
    created_at: u.createdAt.toISOString(),
  };
}

export function serializeApiKey(k: ApiKey) {
  return {
    id: toApiId('apiKey', k.id),
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes as never[],
    last_used_at: iso(k.lastUsedAt),
    created_at: k.createdAt.toISOString(),
  };
}

export function serializeWebhook(w: WebhookEndpoint) {
  return { id: toApiId('webhook', w.id), url: w.url, events: w.events as never[], status: w.status, created_at: w.createdAt.toISOString() };
}

export function serializeLedger(e: CreditLedger) {
  return {
    id: `led_${e.id.replace(/-/g, '')}`,
    kind: e.kind,
    delta: e.delta,
    reserved_delta: e.reservedDelta,
    balance_after: e.balanceAfter,
    reason: e.reason,
    job_id: e.jobId ? toApiId('job', e.jobId) : null,
    created_at: e.createdAt.toISOString(),
  };
}
