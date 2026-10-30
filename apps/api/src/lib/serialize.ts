import type { PrinterDto } from './dimensions';
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

import type { Asset, AssetFile, AssetVersion, ForgeSource, Job } from '@sw/db';

const ID_KEYS: Record<string, Parameters<typeof toApiId>[0]> = {
  asset_id: 'asset',
  version_id: 'version',
  file_id: 'file',
  job_id: 'job',
  part_id: 'part',
  quote_id: 'quote',
  order_id: 'order',
};

/** Render ids inside job output with their API prefixes. */
function mapOutput(out: unknown, kind: Job['kind']): Record<string, unknown> | null {
  if (!out || typeof out !== 'object') return null;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out as Record<string, unknown>)) {
    const idKind = ID_KEYS[k];
    o[k] = idKind && typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) ? toApiId(idKind, v) : v;
  }
  if ((kind === 'FORGE_BUILD' || kind === 'FORGE_EXPORT') && typeof (out as { asset_id?: string }).asset_id === 'string') {
    o.forge_id = toApiId('forge', (out as { asset_id: string }).asset_id);
  }
  return o;
}

export function serializeJob(j: Job) {
  return {
    id: toApiId('job', j.id),
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    forge_state: j.forgeState ?? null,
    attempt: j.attempt,
    error: j.errorCode ? { code: j.errorCode, message: j.errorMessage ?? '' } : null,
    reserved_credits: j.reservedCredits,
    committed_credits: j.committedCredits,
    parent_job_id: j.parentJobId ? toApiId('job', j.parentJobId) : null,
    output: mapOutput(j.output, j.kind),
    created_at: j.createdAt.toISOString(),
    finished_at: iso(j.finishedAt),
  };
}

export function serializeForgeVersion(v: AssetVersion & { forgeSource: ForgeSource | null }) {
  const checks = (v.forgeSource?.checks ?? []) as { id: string; status: 'pass' | 'warn' | 'fail'; title: string; message: string; subpart?: string }[];
  return {
    id: toApiId('version', v.id),
    number: v.number,
    params: (v.params ?? {}) as Record<string, number | string | boolean>,
    bbox_mm: (v.bboxMm ?? null) as number[] | null,
    triangles: v.triangles,
    checks: checks.map((c) => ({ id: c.id, status: c.status, title: c.title, message: c.message, ...(c.subpart ? { subpart: c.subpart } : {}) })),
    checks_failing: checks.some((c) => c.status === 'fail'),
    profile: v.forgeSource?.dfmProfile ?? 'fdm-0.4mm-nozzle',
    author: v.forgeSource?.author ?? 'unknown',
    template_key: v.forgeSource?.templateKey ?? null,
    created_at: v.createdAt.toISOString(),
  };
}

/** Dimension sources for the API (photo line coordinates stay private to the owner's calibration). */
function publicDimensions(d: unknown) {
  const out: Record<string, { source: 'given' | 'default' | 'assumed' | 'user' | 'measured'; confirmed?: boolean; calibration_id?: string; value_mm?: number; stale?: boolean; needs_rebuild?: string[] }> = {};
  for (const [k, v] of Object.entries((d ?? {}) as Record<string, Record<string, unknown>>)) {
    out[k] = {
      source: v.source as 'given',
      ...(typeof v.confirmed === 'boolean' ? { confirmed: v.confirmed } : {}),
      ...(typeof v.calibration_id === 'string' ? { calibration_id: toApiId('calibration', v.calibration_id) } : {}),
      ...(typeof v.value_mm === 'number' ? { value_mm: v.value_mm } : {}),
      ...(v.stale === true ? { stale: true } : {}),
      ...(Array.isArray(v.needs_rebuild) ? { needs_rebuild: v.needs_rebuild as string[] } : {}),
    };
  }
  return out;
}

export function serializeForge(
  a: Asset,
  v: AssetVersion & { forgeSource: ForgeSource | null; files: AssetFile[] },
  isOwner: boolean,
  printer: PrinterDto,
) {
  const file = (role: AssetFile['role']) => {
    const f = v.files.find((x) => x.role === role);
    return f ? toApiId('file', f.id) : null;
  };
  return {
    id: toApiId('forge', a.id),
    asset_id: toApiId('asset', a.id),
    title: a.title,
    prompt: a.prompt,
    visibility: a.visibility,
    is_owner: isOwner,
    forked_from: a.forkedFromId ? toApiId('forge', a.forkedFromId) : null,
    version: serializeForgeVersion(v),
    source: {
      code: v.forgeSource?.code ?? '',
      schema: (v.forgeSource?.schema ?? {}) as Record<string, { type: 'number'; label: string }>,
      dimensions: publicDimensions(v.forgeSource?.dimensions),
    },
    printer,
    files: { preview_mesh: file('PREVIEW_MESH'), thumbnail: file('THUMBNAIL') },
    created_at: a.createdAt.toISOString(),
  };
}

export function serializeFile(f: AssetFile) {
  return { id: toApiId('file', f.id), role: f.role, filename: f.filename, content_type: f.contentType, bytes: f.bytes, expires_at: iso(f.expiresAt) };
}

export function serializeVersion(v: AssetVersion & { files: AssetFile[] }) {
  return {
    id: toApiId('version', v.id),
    number: v.number,
    stage: v.stage,
    provider: v.provider,
    model: v.modelCode,
    triangles: v.triangles,
    bbox_mm: (v.bboxMm ?? null) as number[] | null,
    is_watertight: v.isWatertight,
    analysis: (v.analysis ?? null) as Record<string, unknown> | null,
    parent_version_id: v.parentVersionId ? toApiId('version', v.parentVersionId) : null,
    job_id: v.jobId ? toApiId('job', v.jobId) : null,
    files: v.files.filter((f) => !f.expiresAt || f.expiresAt > new Date()).map(serializeFile),
    created_at: v.createdAt.toISOString(),
  };
}

export function serializeAssetSummary(a: Asset, current: (AssetVersion & { files: AssetFile[] }) | null) {
  const thumb = current?.files.find((f) => f.role === 'THUMBNAIL');
  return {
    id: a.kind === 'FORGE' ? toApiId('forge', a.id) : toApiId('asset', a.id),
    kind: a.kind,
    title: a.title,
    prompt: a.prompt,
    visibility: a.visibility,
    current_version: current ? serializeVersion(current) : null,
    thumbnail_file_id: thumb ? toApiId('file', thumb.id) : null,
    created_at: a.createdAt.toISOString(),
  };
}

export function serializeUpload(u: { id: string; status: string; purpose: string; filename: string; bytes: number; rejectReason: string | null; expiresAt: Date }) {
  return {
    id: toApiId('upload', u.id),
    status: u.status as 'PENDING',
    purpose: u.purpose.toLowerCase() as 'print' | 'image',
    filename: u.filename,
    bytes: u.bytes,
    reject_reason: u.rejectReason,
    expires_at: u.expiresAt.toISOString(),
  };
}
