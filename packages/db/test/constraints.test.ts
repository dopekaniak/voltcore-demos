import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/index';

const db = createDb(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

async function newWallet() {
  const user = await db.user.create({ data: { email: `c-${crypto.randomUUID()}@example.test` } });
  return db.creditWallet.create({ data: { ownerId: user.id } });
}

describe('database constraints', () => {
  it('rejects UPDATE and DELETE on the credit ledger', async () => {
    const w = await newWallet();
    const row = await db.creditLedger.create({
      data: { walletId: w.id, kind: 'GRANT', delta: 5, balanceAfter: 5, reservedAfter: 0, idempotencyKey: crypto.randomUUID() },
    });
    await expect(db.creditLedger.update({ where: { id: row.id }, data: { delta: 6 } })).rejects.toThrow(/append-only/);
    await expect(db.creditLedger.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('TRUNCATE credit_ledger')).rejects.toThrow(/append-only/);
  });

  it('enforces reserved >= 0 and balance >= reserved', async () => {
    const w = await newWallet();
    await expect(db.creditWallet.update({ where: { id: w.id }, data: { reserved: -1 } })).rejects.toThrow(/reserved_nonneg/);
    await expect(db.creditWallet.update({ where: { id: w.id }, data: { balance: 1, reserved: 2 } })).rejects.toThrow(/balance_covers_reserved/);
  });

  it('rejects UPDATE on audit log and job events', async () => {
    const a = await db.auditLog.create({ data: { action: 'test', targetType: 'x', targetId: 'y' } });
    await expect(db.auditLog.update({ where: { seq: a.seq }, data: { action: 'z' } })).rejects.toThrow(/append-only/);
  });

  it('has the partial and trigram indexes', async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('jobs_status_next_run_at_pending_idx');
    expect(names).toContain('assets_title_trgm_idx');
  });

  it('seeds plans, packs, materials, partners, pricing, models', async () => {
    expect(await db.plan.count()).toBe(3);
    expect(await db.creditPack.count()).toBeGreaterThanOrEqual(3);
    expect((await db.material.findMany()).map((m) => m.code).sort()).toEqual(['ASA', 'PETG', 'PLA']);
    expect(await db.printPartner.count()).toBe(2);
    expect(await db.pricingConfig.findUnique({ where: { version: 1 } })).not.toBeNull();
    expect(await db.generationModel.count({ where: { providerKey: 'mock' } })).toBeGreaterThanOrEqual(1);
  });
});
