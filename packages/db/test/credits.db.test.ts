import { afterAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDb } from '../src/index';
import { credits, ledgerSum } from '../src/credits';
import { onboardUser } from '../src/users';

const db = createDb(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
const key = () => crypto.randomUUID();

async function newUser() {
  return db.$transaction((tx) => onboardUser(tx, { email: `w-${crypto.randomUUID()}@example.test` }));
}

describe('credit service against Postgres', () => {
  it('onboards with 100 free credits that expire at period end', async () => {
    const { userId } = await newUser();
    const w = await db.creditWallet.findUniqueOrThrow({ where: { ownerId: userId } });
    expect(w.balance).toBe(100);
    const g = await db.creditGrant.findFirstOrThrow({ where: { walletId: w.id } });
    expect(g.expiresAt).not.toBeNull();
    expect(await ledgerSum(db, w.id)).toBe(100);
  });

  it('reserve → commit is idempotent and consistent', async () => {
    const { userId } = await newUser();
    const k = key();
    const r1 = await db.$transaction((tx) => credits.reserve(tx, { ownerId: userId, amount: 30, expiresAt: new Date(Date.now() + 3600e3), idempotencyKey: k }));
    const r2 = await db.$transaction((tx) => credits.reserve(tx, { ownerId: userId, amount: 30, expiresAt: new Date(Date.now() + 3600e3), idempotencyKey: k }));
    expect(r2.duplicate).toBe(true);
    expect(r2.reservationId).toBe(r1.reservationId);
    await db.$transaction((tx) => credits.commit(tx, { reservationId: r1.reservationId, actual: 20, idempotencyKey: `${k}:c` }));
    await db.$transaction((tx) => credits.commit(tx, { reservationId: r1.reservationId, actual: 20, idempotencyKey: `${k}:c` }));
    const w = await db.creditWallet.findUniqueOrThrow({ where: { ownerId: userId } });
    expect([w.balance, w.reserved]).toEqual([80, 0]);
    expect(await ledgerSum(db, w.id)).toBe(80);
  });

  it('serializes concurrent reservations so the wallet cannot be overspent', async () => {
    const { userId } = await newUser();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        db.$transaction((tx) => credits.reserve(tx, { ownerId: userId, amount: 30, expiresAt: new Date(Date.now() + 3600e3), idempotencyKey: key() })),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(3);
    const failed = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(failed.every((f) => f.reason.code === 'INSUFFICIENT_CREDITS')).toBe(true);
    const w = await db.creditWallet.findUniqueOrThrow({ where: { ownerId: userId } });
    expect(w.reserved).toBe(90);
  });

  it('random sequences keep balance == ledger sum in the database', async () => {
    const runs = Number(process.env.FAST_CHECK_DB_RUNS ?? 25);
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.constantFrom('reserve', 'commit', 'release', 'grant', 'adjust'), fc.integer({ min: 1, max: 80 })), { maxLength: 12 }), async (steps) => {
        const { userId } = await newUser();
        const open: string[] = [];
        for (const [t, n] of steps) {
          try {
            await db.$transaction(async (tx) => {
              if (t === 'reserve') open.push((await credits.reserve(tx, { ownerId: userId, amount: n, expiresAt: new Date(Date.now() + 1e6), idempotencyKey: key() })).reservationId);
              else if (t === 'commit' && open.length) await credits.commit(tx, { reservationId: open.shift()!, actual: Math.floor(n / 2), idempotencyKey: key() });
              else if (t === 'release' && open.length) await credits.release(tx, { reservationId: open.shift()!, idempotencyKey: key() });
              else if (t === 'grant') await credits.grant(tx, { ownerId: userId, amount: n, source: 'PACK', expiresAt: null, idempotencyKey: key() });
              else if (t === 'adjust') await credits.adjust(tx, { ownerId: userId, delta: -n, idempotencyKey: key(), reason: 'test', actorId: userId });
            });
          } catch (e) {
            expect((e as { code?: string }).code).toMatch(/INSUFFICIENT_CREDITS|INVALID_STATE/);
          }
        }
        const w = await db.creditWallet.findUniqueOrThrow({ where: { ownerId: userId } });
        expect(w.balance).toBeGreaterThanOrEqual(w.reserved);
        expect(await ledgerSum(db, w.id)).toBe(w.balance);
        const grants = await db.creditGrant.aggregate({ where: { walletId: w.id }, _sum: { remaining: true } });
        expect(grants._sum.remaining).toBe(w.balance);
      }),
      { numRuns: runs },
    );
  });
});
