import {
  AppError,
  applyCreditOp,
  CreditError,
  newId,
  type CreditOp,
  type GrantSource,
  type WalletState,
} from '@sw/shared';
import type { Prisma } from '@prisma/client';
import type { Tx } from './index';

/**
 * Credit wallet service (ADR-005). Every method runs inside the caller's transaction,
 * locks the wallet row with SELECT ... FOR UPDATE, applies the pure operation from
 * @sw/shared, and writes ledger rows with idempotency keys. Re-running a call with the same
 * idempotency key is a no-op that returns `{ duplicate: true }`.
 */

interface WalletRow {
  id: string;
  owner_id: string;
  balance: number;
  reserved: number;
}

export interface CreditCallResult {
  duplicate: boolean;
  walletId: string;
  balance: number;
  reserved: number;
}

async function lockWallet(tx: Tx, ownerId: string): Promise<WalletRow> {
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT id, owner_id, balance, reserved FROM credit_wallets WHERE owner_id = ${ownerId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'wallet not found');
  return row;
}

async function alreadyApplied(tx: Tx, idempotencyKey: string): Promise<boolean> {
  const hit = await tx.creditLedger.findFirst({
    where: { idempotencyKey: { in: [idempotencyKey, `${idempotencyKey}:0`] } },
    select: { id: true },
  });
  return hit !== null;
}

async function loadState(tx: Tx, wallet: WalletRow, reservationId?: string): Promise<WalletState> {
  const grants = await tx.creditGrant.findMany({ where: { walletId: wallet.id, remaining: { gt: 0 } } });
  const state: WalletState = {
    balance: wallet.balance,
    reserved: wallet.reserved,
    grants: grants.map((g) => ({
      id: g.id,
      source: g.source,
      amount: g.amount,
      remaining: g.remaining,
      expiresAt: g.expiresAt ? g.expiresAt.getTime() : null,
      createdAt: g.createdAt.getTime(),
    })),
    reservations: {},
  };
  if (reservationId) {
    const r = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (r && r.walletId === wallet.id) {
      state.reservations[r.id] = { id: r.id, amount: r.amount, status: r.status, committedAmount: r.committedAmount };
    }
  }
  return state;
}

interface ApplyOpts {
  ownerId: string;
  op: CreditOp;
  idempotencyKey: string;
  jobId?: string | null;
  reason?: string | null;
  actorId?: string | null;
  reservationExpiresAt?: Date;
  grantSourceRef?: string | null;
  now?: Date;
}

async function apply(tx: Tx, o: ApplyOpts): Promise<CreditCallResult> {
  const wallet = await lockWallet(tx, o.ownerId);
  if (await alreadyApplied(tx, o.idempotencyKey)) {
    return { duplicate: true, walletId: wallet.id, balance: wallet.balance, reserved: wallet.reserved };
  }
  const reservationId = 'reservationId' in o.op ? o.op.reservationId : undefined;
  const before = await loadState(tx, wallet, reservationId);
  const now = (o.now ?? new Date()).getTime();
  let result;
  try {
    result = applyCreditOp(before, o.op, now);
  } catch (e) {
    if (e instanceof CreditError) {
      if (e.code === 'INSUFFICIENT_CREDITS') {
        throw new AppError('INSUFFICIENT_CREDITS', 'Not enough credits', {
          available: before.balance - before.reserved,
        });
      }
      if (e.code === 'UNKNOWN_RESERVATION') throw new AppError('NOT_FOUND', 'reservation not found');
      throw new AppError('INVALID_STATE', e.message);
    }
    throw e;
  }
  const after = result.state;

  // Grants: create new ones, update changed remaining.
  for (const [grantId, remaining] of Object.entries(result.grantChanges)) {
    const isNew = !before.grants.some((g) => g.id === grantId);
    if (isNew) {
      const g = after.grants.find((x) => x.id === grantId)!;
      await tx.creditGrant.create({
        data: {
          id: g.id,
          walletId: wallet.id,
          source: g.source,
          amount: g.amount,
          remaining: g.remaining,
          expiresAt: g.expiresAt === null ? null : new Date(g.expiresAt),
          sourceRef: o.grantSourceRef ?? null,
        },
      });
    } else {
      await tx.creditGrant.update({ where: { id: grantId }, data: { remaining } });
    }
  }

  // Reservation row.
  if (o.op.type === 'reserve') {
    await tx.reservation.create({
      data: {
        id: o.op.reservationId,
        walletId: wallet.id,
        amount: o.op.amount,
        jobId: o.jobId ?? null,
        expiresAt: o.reservationExpiresAt ?? new Date(now + 2 * 3600_000),
      },
    });
  } else if (reservationId) {
    const r = after.reservations[reservationId]!;
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: r.status, committedAmount: r.committedAmount },
    });
  }

  await tx.creditWallet.update({ where: { id: wallet.id }, data: { balance: after.balance, reserved: after.reserved } });
  const rows: Prisma.CreditLedgerCreateManyInput[] = result.entries.map((e, i) => ({
    walletId: wallet.id,
    kind: e.kind,
    delta: e.delta,
    reservedDelta: e.reservedDelta,
    balanceAfter: e.balanceAfter,
    reservedAfter: e.reservedAfter,
    idempotencyKey: result.entries.length === 1 ? o.idempotencyKey : `${o.idempotencyKey}:${i}`,
    reservationId: e.reservationId ?? null,
    grantId: e.grantId ?? null,
    jobId: o.jobId ?? null,
    reason: o.reason ?? null,
    actorId: o.actorId ?? null,
  }));
  if (rows.length) await tx.creditLedger.createMany({ data: rows });
  return { duplicate: false, walletId: wallet.id, balance: after.balance, reserved: after.reserved };
}

export async function ensureWallet(tx: Tx, ownerId: string): Promise<string> {
  const w = await tx.creditWallet.upsert({ where: { ownerId }, update: {}, create: { ownerId } });
  return w.id;
}

export const credits = {
  grant(
    tx: Tx,
    a: { ownerId: string; amount: number; source: GrantSource; expiresAt: Date | null; idempotencyKey: string; sourceRef?: string; reason?: string; actorId?: string; now?: Date },
  ) {
    return apply(tx, {
      ownerId: a.ownerId,
      op: { type: 'grant', grantId: newId(), source: a.source, amount: a.amount, expiresAt: a.expiresAt ? a.expiresAt.getTime() : null },
      idempotencyKey: a.idempotencyKey,
      grantSourceRef: a.sourceRef ?? null,
      reason: a.reason ?? null,
      actorId: a.actorId ?? null,
      ...(a.now ? { now: a.now } : {}),
    });
  },

  async reserve(
    tx: Tx,
    a: { ownerId: string; amount: number; jobId?: string; expiresAt: Date; idempotencyKey: string; reservationId?: string },
  ): Promise<CreditCallResult & { reservationId: string }> {
    const reservationId = a.reservationId ?? newId();
    const res = await apply(tx, {
      ownerId: a.ownerId,
      op: { type: 'reserve', reservationId, amount: a.amount },
      idempotencyKey: a.idempotencyKey,
      jobId: a.jobId ?? null,
      reservationExpiresAt: a.expiresAt,
    });
    if (res.duplicate) {
      const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: a.idempotencyKey } });
      return { ...res, reservationId: existing?.reservationId ?? reservationId };
    }
    return { ...res, reservationId };
  },

  async commit(tx: Tx, a: { reservationId: string; actual: number; idempotencyKey: string }) {
    const ownerId = await reservationOwner(tx, a.reservationId);
    return apply(tx, { ownerId, op: { type: 'commit', reservationId: a.reservationId, actual: a.actual }, idempotencyKey: a.idempotencyKey });
  },

  async release(tx: Tx, a: { reservationId: string; idempotencyKey: string; expired?: boolean }) {
    const ownerId = await reservationOwner(tx, a.reservationId);
    return apply(tx, {
      ownerId,
      op: { type: a.expired ? 'expireReservation' : 'release', reservationId: a.reservationId },
      idempotencyKey: a.idempotencyKey,
    });
  },

  expireGrants(tx: Tx, a: { ownerId: string; now: Date; idempotencyKey: string }) {
    return apply(tx, { ownerId: a.ownerId, op: { type: 'expireGrants', now: a.now.getTime() }, idempotencyKey: a.idempotencyKey, now: a.now });
  },

  /** Admin adjustment: positive grants non-expiring credits, negative debits. */
  adjust(tx: Tx, a: { ownerId: string; delta: number; idempotencyKey: string; reason: string; actorId: string }) {
    if (!Number.isSafeInteger(a.delta) || a.delta === 0) throw new AppError('VALIDATION_FAILED', 'delta must be a non-zero integer');
    const op: CreditOp =
      a.delta > 0
        ? { type: 'grant', grantId: newId(), source: 'ADMIN', amount: a.delta, expiresAt: null, kind: 'ADJUST' }
        : { type: 'debit', amount: -a.delta, kind: 'ADJUST' };
    return apply(tx, { ownerId: a.ownerId, op, idempotencyKey: a.idempotencyKey, reason: a.reason, actorId: a.actorId });
  },
};

async function reservationOwner(tx: Tx, reservationId: string): Promise<string> {
  const r = await tx.reservation.findUnique({ where: { id: reservationId }, include: { wallet: { select: { ownerId: true } } } });
  if (!r) throw new AppError('NOT_FOUND', 'reservation not found');
  return r.wallet.ownerId;
}

/** Sum of ledger deltas for a wallet; must equal its balance. */
export async function ledgerSum(tx: Tx, walletId: string): Promise<number> {
  const agg = await tx.creditLedger.aggregate({ where: { walletId }, _sum: { delta: true } });
  return agg._sum.delta ?? 0;
}
