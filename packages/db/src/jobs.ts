import type { Prisma, Job, JobKind, JobStatus } from '@prisma/client';
import { AppError, assertTransition, canTransition, forgeBuildMachine, jobMachine, newId, type ForgeBuildState } from '@sw/shared';
import type { Db, Tx } from './index';
import { credits } from './credits';
import { enqueue, type Topic } from './outbox';
import { emitUserEvent } from './events';

export const TOPIC_FOR_KIND: Record<JobKind, Topic> = {
  GENERATE: 'generation',
  REFINE: 'generation',
  RETEXTURE: 'generation',
  REMESH: 'mesh-analysis',
  FORGE_BUILD: 'forge-build',
  FORGE_EXPORT: 'forge-build',
  MESH_ANALYZE: 'mesh-analysis',
  PRINT_QUOTE: 'print-quote',
};

export interface CreateJobInput {
  ownerId: string | null;
  anonId?: string | null;
  kind: JobKind;
  idempotencyKey: string;
  input: Prisma.InputJsonValue;
  /** Maximum credit cost to reserve now (ADR-005). 0 for free jobs. */
  reserveCredits: number;
  timeoutMs: number;
  parentJobId?: string | null;
  assetId?: string | null;
  assetVersionId?: string | null;
  providerKey?: string | null;
  modelCode?: string | null;
  maxAttempts?: number;
  now?: Date;
}

/**
 * Create a job, its credit reservation, its first event, and its outbox message in the
 * caller's transaction (ADR-004, ADR-005). A repeated idempotency key returns the existing
 * job unchanged.
 */
export async function createJob(tx: Tx, a: CreateJobInput): Promise<{ job: Job; created: boolean }> {
  const existing = a.ownerId
    ? await tx.job.findUnique({ where: { ownerId_idempotencyKey: { ownerId: a.ownerId, idempotencyKey: a.idempotencyKey } } })
    : await tx.job.findUnique({ where: { anonId_idempotencyKey: { anonId: a.anonId!, idempotencyKey: a.idempotencyKey } } });
  if (existing) return { job: existing, created: false };
  const now = a.now ?? new Date();
  const id = newId();
  let reservationId: string | null = null;
  if (a.reserveCredits > 0) {
    if (!a.ownerId) throw new AppError('UNAUTHENTICATED', 'Sign in to spend credits');
    const r = await credits.reserve(tx, {
      ownerId: a.ownerId,
      amount: a.reserveCredits,
      jobId: id,
      expiresAt: new Date(now.getTime() + a.timeoutMs + 3600_000),
      idempotencyKey: `job-reserve:${id}`,
    });
    reservationId = r.reservationId;
  }
  const job = await tx.job.create({
    data: {
      id,
      ownerId: a.ownerId,
      anonId: a.ownerId ? null : (a.anonId ?? null),
      kind: a.kind,
      idempotencyKey: a.idempotencyKey,
      input: a.input,
      reservedCredits: a.reserveCredits,
      reservationId,
      timeoutAt: new Date(now.getTime() + a.timeoutMs),
      nextRunAt: now,
      parentJobId: a.parentJobId ?? null,
      assetId: a.assetId ?? null,
      assetVersionId: a.assetVersionId ?? null,
      providerKey: a.providerKey ?? null,
      modelCode: a.modelCode ?? null,
      maxAttempts: a.maxAttempts ?? 3,
      ...(a.kind === 'FORGE_BUILD' ? { forgeState: 'DRAFT' as const } : {}),
    },
  });
  await tx.jobEvent.create({ data: { jobId: id, type: 'created', toStatus: 'QUEUED', progress: 0, data: { kind: a.kind } } });
  await enqueue(tx, TOPIC_FOR_KIND[a.kind], `${id}:0`, { jobId: id });
  return { job, created: true };
}

/** Claim a queued job for this worker. Returns null if someone else has it or it is not runnable. */
export async function claimJob(db: Db, jobId: string, workerId: string, now = new Date()): Promise<Job | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs WHERE id = ${jobId}::uuid AND status = 'QUEUED' FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return null;
    const job = await tx.job.update({
      where: { id: jobId },
      data: { status: 'RUNNING', lockedBy: workerId, lockedAt: now, attempt: { increment: 1 }, startedAt: now },
    });
    await tx.jobEvent.create({ data: { jobId, type: 'status', fromStatus: 'QUEUED', toStatus: 'RUNNING', data: { attempt: job.attempt } } });
    return job;
  });
}

export async function jobProgress(db: Db | Tx, jobId: string, progress: number, data?: Prisma.InputJsonValue): Promise<void> {
  const p = Math.max(0, Math.min(99, Math.round(progress)));
  // Progress never moves a terminal job and never goes backwards.
  const r = await db.job.updateMany({ where: { id: jobId, status: 'RUNNING', progress: { lte: p } }, data: { progress: p } });
  if (r.count) await db.jobEvent.create({ data: { jobId, type: 'progress', progress: p, ...(data !== undefined ? { data } : {}) } });
}

export async function forgeState(db: Db | Tx, job: Pick<Job, 'id' | 'forgeState'>, to: ForgeBuildState, data?: Prisma.InputJsonValue): Promise<void> {
  const from = (job.forgeState ?? 'DRAFT') as ForgeBuildState;
  assertTransition(forgeBuildMachine, from, to);
  await db.job.update({ where: { id: job.id }, data: { forgeState: to } });
  await db.jobEvent.create({ data: { jobId: job.id, type: 'forge_state', data: { from, to, ...((data as object) ?? {}) } } });
  (job as { forgeState: ForgeBuildState }).forgeState = to;
}

async function lockJob(tx: Tx, id: string): Promise<Job> {
  await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.job.findUniqueOrThrow({ where: { id } });
}

async function move(tx: Tx, job: Job, to: JobStatus, data: Prisma.JobUpdateInput, event: Prisma.InputJsonValue = {}): Promise<Job> {
  assertTransition(jobMachine, job.status, to);
  const updated = await tx.job.update({ where: { id: job.id }, data: { status: to, ...data } });
  await tx.jobEvent.create({ data: { jobId: job.id, type: 'status', fromStatus: job.status, toStatus: to, progress: updated.progress, data: event } });
  return updated;
}

/**
 * Success: commit the actual credits and move to SUCCEEDED in one transaction. `extra`
 * runs in the same transaction (e.g. creating the asset version).
 */
export async function succeedJob(
  db: Db,
  jobId: string,
  a: { actualCredits: number; output?: Prisma.InputJsonValue; assetId?: string | null; assetVersionId?: string | null },
  extra?: (tx: Tx, job: Job) => Promise<void>,
): Promise<Job | null> {
  return db.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== 'RUNNING') return null; // canceled or finished elsewhere: do nothing
    if (extra) await extra(tx, job);
    const actual = Math.min(a.actualCredits, job.reservedCredits);
    if (job.reservationId) await credits.commit(tx, { reservationId: job.reservationId, actual, idempotencyKey: `job-commit:${job.id}` });
    const done = await move(tx, job, 'SUCCEEDED', {
      progress: 100,
      ...(a.output !== undefined ? { output: a.output } : {}),
      committedCredits: actual,
      finishedAt: new Date(),
      lockedBy: null,
      ...(a.assetId !== undefined ? { assetId: a.assetId } : {}),
      ...(a.assetVersionId !== undefined ? { assetVersionId: a.assetVersionId } : {}),
    });
    if (job.ownerId) await emitUserEvent(tx, job.ownerId, 'job.succeeded', { job_id: job.id, kind: job.kind });
    return done;
  });
}

/**
 * Failure. Retryable failures with attempts left go RUNNING → RETRYING → QUEUED with a
 * backoff and a new outbox message; otherwise FAILED and the reservation is released in
 * the same transaction (failed jobs are never charged).
 */
export async function failJob(
  db: Db,
  jobId: string,
  a: { code: string; message: string; retryable?: boolean; backoffMs?: number; output?: Prisma.InputJsonValue },
): Promise<Job | null> {
  return db.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== 'RUNNING') return null;
    const base = { errorCode: a.code, errorMessage: a.message.slice(0, 2000), lockedBy: null, ...(a.output !== undefined ? { output: a.output } : {}) };
    if (a.retryable && job.attempt < job.maxAttempts) {
      const retrying = await move(tx, job, 'RETRYING', base, { code: a.code });
      const at = new Date(Date.now() + (a.backoffMs ?? 2000 * 2 ** job.attempt));
      const queued = await move(tx, retrying, 'QUEUED', { nextRunAt: at }, { retry_at: at.toISOString() });
      await enqueue(tx, TOPIC_FOR_KIND[job.kind], `${job.id}:${job.attempt}`, { jobId: job.id }, at);
      return queued;
    }
    if (job.reservationId) await credits.release(tx, { reservationId: job.reservationId, idempotencyKey: `job-release:${job.id}` });
    const failed = await move(tx, job, 'FAILED', { ...base, finishedAt: new Date(), ...(job.kind === 'FORGE_BUILD' && job.forgeState !== 'READY' ? { forgeState: 'FAILED' as const } : {}) }, { code: a.code, message: a.message.slice(0, 500) });
    if (job.ownerId) {
      await emitUserEvent(tx, job.ownerId, 'job.failed', { job_id: job.id, kind: job.kind, code: a.code });
    }
    return failed;
  });
}

/** Cancel a queued or running job; releases its credits (canceled jobs are refunded). */
export async function cancelJob(db: Db, jobId: string, ownerId: string): Promise<Job> {
  return db.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.ownerId !== ownerId) throw new AppError('NOT_FOUND', 'Job not found');
    if (!canTransition(jobMachine, job.status, 'CANCELED')) throw new AppError('INVALID_STATE', `A ${job.status} job cannot be canceled`);
    if (job.reservationId) await credits.release(tx, { reservationId: job.reservationId, idempotencyKey: `job-release:${job.id}` });
    return move(tx, job, 'CANCELED', { finishedAt: new Date(), lockedBy: null }, { by: 'owner' });
  });
}

/**
 * Retry a FAILED job as a new job with the same input (the original stays FAILED, so its
 * history is intact). Returns the new job.
 */
export async function retryAsNewJob(tx: Tx, failed: Job, reserveCredits: number, timeoutMs: number): Promise<Job> {
  if (failed.status !== 'FAILED' && failed.status !== 'CANCELED') throw new AppError('INVALID_STATE', 'Only failed or canceled jobs can be retried');
  const { job } = await createJob(tx, {
    ownerId: failed.ownerId,
    anonId: failed.anonId,
    kind: failed.kind,
    idempotencyKey: `retry:${failed.id}:${newId()}`,
    input: failed.input as Prisma.InputJsonValue,
    reserveCredits,
    timeoutMs,
    parentJobId: failed.parentJobId,
    assetId: failed.assetId,
    assetVersionId: failed.assetVersionId,
    providerKey: failed.providerKey,
    modelCode: failed.modelCode,
  });
  await tx.jobEvent.create({ data: { jobId: job.id, type: 'retry_of', data: { job_id: failed.id } } });
  return job;
}
