import { addMonths, credits, type Db } from '@sw/db';
import { jobMachine, canTransition } from '@sw/shared';

/**
 * Housekeeping (build prompt section 6):
 * - release reservations past their expiry (job timeout + 1 h) and fail their jobs;
 * - expire monthly plan credits past period end;
 * - roll Free subscriptions into a new period with fresh credits.
 */
export async function reap(db: Db, now = new Date()): Promise<{ released: number; expiredGrants: number; renewed: number }> {
  let released = 0;
  const stale = await db.reservation.findMany({ where: { status: 'RESERVED', expiresAt: { lt: now } }, take: 500 });
  for (const r of stale) {
    await db.$transaction(async (tx) => {
      const res = await credits.release(tx, { reservationId: r.id, idempotencyKey: `reaper:release:${r.id}`, expired: true });
      if (!res.duplicate) released++;
      if (r.jobId) {
        const job = await tx.job.findUnique({ where: { id: r.jobId } });
        if (job && canTransition(jobMachine, job.status, 'FAILED')) {
          await tx.job.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'JOB_TIMEOUT', errorMessage: 'Job did not finish in time', finishedAt: now, lockedBy: null } });
          await tx.jobEvent.create({ data: { jobId: job.id, type: 'status', fromStatus: job.status, toStatus: 'FAILED', data: { reason: 'reaper' } } });
        }
      }
    });
  }

  let expiredGrants = 0;
  const wallets = await db.creditGrant.findMany({
    where: { expiresAt: { lt: now }, remaining: { gt: 0 } },
    select: { walletId: true, wallet: { select: { ownerId: true } } },
    distinct: ['walletId'],
    take: 500,
  });
  for (const w of wallets) {
    await db.$transaction(async (tx) => {
      const r = await credits.expireGrants(tx, { ownerId: w.wallet.ownerId, now, idempotencyKey: `reaper:expire:${w.walletId}:${now.toISOString()}` });
      if (!r.duplicate) expiredGrants++;
    });
  }

  let renewed = 0;
  const due = await db.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now }, plan: { code: 'free' } }, include: { plan: true }, take: 500 });
  for (const sub of due) {
    await db.$transaction(async (tx) => {
      const start = sub.currentPeriodEnd;
      const end = addMonths(start, 1);
      const moved = await tx.subscription.updateMany({ where: { id: sub.id, currentPeriodEnd: start }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
      if (moved.count !== 1) return;
      await credits.grant(tx, {
        ownerId: sub.ownerId,
        amount: sub.plan.monthlyCredits,
        source: 'PLAN',
        expiresAt: end,
        sourceRef: `${sub.id}:${start.toISOString().slice(0, 10)}`,
        idempotencyKey: `plan-grant:${sub.id}:${start.toISOString()}`,
        reason: 'Free plan monthly credits',
        now,
      });
      renewed++;
    });
  }
  return { released, expiredGrants, renewed };
}
