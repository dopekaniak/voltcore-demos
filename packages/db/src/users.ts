import { newId } from '@sw/shared';
import type { Tx } from './index';
import { credits, ensureWallet } from './credits';

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/**
 * Create a user with a wallet, a Free subscription for the current month, and that
 * month's plan credits (expiring at period end). Idempotent per email.
 */
export async function onboardUser(
  tx: Tx,
  a: { email: string; role?: 'USER' | 'ADMIN' | 'OPS'; now?: Date },
): Promise<{ userId: string; created: boolean }> {
  const email = a.email.trim().toLowerCase();
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing) return { userId: existing.id, created: false };
  const now = a.now ?? new Date();
  const user = await tx.user.create({ data: { id: newId(), email, role: a.role ?? 'USER' } });
  await ensureWallet(tx, user.id);
  const plan = await tx.plan.findUniqueOrThrow({ where: { code: 'free' } });
  const periodEnd = addMonths(now, 1);
  const sub = await tx.subscription.create({
    data: { ownerId: user.id, planId: plan.id, currentPeriodStart: now, currentPeriodEnd: periodEnd },
  });
  if (plan.monthlyCredits > 0) {
    await credits.grant(tx, {
      ownerId: user.id,
      amount: plan.monthlyCredits,
      source: 'PLAN',
      expiresAt: periodEnd,
      sourceRef: `${sub.id}:${now.toISOString().slice(0, 10)}`,
      idempotencyKey: `plan-grant:${sub.id}:${now.toISOString()}`,
      reason: 'Free plan monthly credits',
      now,
    });
  }
  return { userId: user.id, created: true };
}

/** Move anonymous print parts, uploads, quotes, and jobs to a user after sign-in. */
export async function claimAnonymous(tx: Tx, userId: string, anonId: string): Promise<number> {
  const where = { anonId, ownerId: null };
  const [a, b, c, d] = await Promise.all([
    tx.printPart.updateMany({ where, data: { ownerId: userId, expiresAt: null } }),
    tx.upload.updateMany({ where, data: { ownerId: userId } }),
    tx.quote.updateMany({ where, data: { ownerId: userId } }),
    tx.job.updateMany({ where, data: { ownerId: userId } }),
  ]);
  return a.count + b.count + c.count + d.count;
}
