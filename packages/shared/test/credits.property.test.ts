import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyCreditOp, checkInvariants, CreditError, emptyWallet, type CreditOp, type WalletState } from '../src/credits';

const RUNS = Number(process.env.FAST_CHECK_RUNS ?? 10000);

type Step =
  | { t: 'grant'; amount: number; expires: boolean; pack: boolean }
  | { t: 'reserve'; amount: number }
  | { t: 'commit'; pick: number; frac: number }
  | { t: 'release'; pick: number }
  | { t: 'expireRes'; pick: number }
  | { t: 'expireGrants' }
  | { t: 'debit'; amount: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ t: fc.constant('grant' as const), amount: fc.integer({ min: 1, max: 500 }), expires: fc.boolean(), pack: fc.boolean() }),
  fc.record({ t: fc.constant('reserve' as const), amount: fc.integer({ min: 0, max: 300 }) }),
  fc.record({ t: fc.constant('commit' as const), pick: fc.nat(), frac: fc.integer({ min: 0, max: 100 }) }),
  fc.record({ t: fc.constant('release' as const), pick: fc.nat() }),
  fc.record({ t: fc.constant('expireRes' as const), pick: fc.nat() }),
  fc.constant({ t: 'expireGrants' as const }),
  fc.record({ t: fc.constant('debit' as const), amount: fc.integer({ min: 1, max: 200 }) }),
);

describe('credit wallet property', () => {
  it(`never goes negative and balance equals the ledger sum (${RUNS} runs)`, () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let s: WalletState = emptyWallet();
        let ledgerSum = 0;
        let clock = 0;
        let n = 0;
        for (const st of steps) {
          clock += 1000;
          const open = Object.values(s.reservations).filter((r) => r.status === 'RESERVED');
          const pick = (i: number) => open.length ? open[i % open.length]! : Object.values(s.reservations)[i % Math.max(1, Object.keys(s.reservations).length)];
          let op: CreditOp | null = null;
          switch (st.t) {
            case 'grant':
              op = { type: 'grant', grantId: `g${n++}`, source: st.pack ? 'PACK' : 'PLAN', amount: st.amount, expiresAt: st.expires ? clock + 5000 : null };
              break;
            case 'reserve':
              op = { type: 'reserve', reservationId: `r${n++}`, amount: st.amount };
              break;
            case 'commit': {
              const r = pick(st.pick);
              if (r) op = { type: 'commit', reservationId: r.id, actual: Math.floor((r.amount * st.frac) / 100) };
              break;
            }
            case 'release': {
              const r = pick(st.pick);
              if (r) op = { type: 'release', reservationId: r.id };
              break;
            }
            case 'expireRes': {
              const r = pick(st.pick);
              if (r) op = { type: 'expireReservation', reservationId: r.id };
              break;
            }
            case 'expireGrants':
              op = { type: 'expireGrants', now: clock };
              break;
            case 'debit':
              op = { type: 'debit', amount: st.amount, kind: 'ADJUST' };
              break;
          }
          if (!op) continue;
          try {
            const res = applyCreditOp(s, op, clock);
            s = res.state;
            ledgerSum += res.entries.reduce((a, e) => a + e.delta, 0);
            for (const e of res.entries) {
              expect(e.balanceAfter).toBeGreaterThanOrEqual(e.reservedAfter);
              expect(e.reservedAfter).toBeGreaterThanOrEqual(0);
            }
          } catch (e) {
            // Rejected operations must leave the state untouched and be typed errors.
            expect(e).toBeInstanceOf(CreditError);
          }
          expect(checkInvariants(s, ledgerSum)).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('rejects overspending a reservation and double commits', () => {
    let s = applyCreditOp(emptyWallet(), { type: 'grant', grantId: 'g', source: 'PLAN', amount: 10, expiresAt: null }).state;
    expect(() => applyCreditOp(s, { type: 'reserve', reservationId: 'r', amount: 11 })).toThrow(/needs 11/);
    s = applyCreditOp(s, { type: 'reserve', reservationId: 'r', amount: 8 }).state;
    expect(() => applyCreditOp(s, { type: 'reserve', reservationId: 'r2', amount: 3 })).toThrow(CreditError);
    expect(() => applyCreditOp(s, { type: 'commit', reservationId: 'r', actual: 9 })).toThrow(/actual/);
    s = applyCreditOp(s, { type: 'commit', reservationId: 'r', actual: 5 }).state;
    expect(s.balance).toBe(5);
    expect(s.reserved).toBe(0);
    expect(() => applyCreditOp(s, { type: 'release', reservationId: 'r' })).toThrow(/COMMITTED/);
  });

  it('spends expiring plan credits before packs, and expiry spares packs', () => {
    let s = emptyWallet();
    s = applyCreditOp(s, { type: 'grant', grantId: 'pack', source: 'PACK', amount: 50, expiresAt: null }, 1).state;
    s = applyCreditOp(s, { type: 'grant', grantId: 'plan', source: 'PLAN', amount: 100, expiresAt: 10_000 }, 2).state;
    s = applyCreditOp(s, { type: 'reserve', reservationId: 'r', amount: 30 }).state;
    s = applyCreditOp(s, { type: 'commit', reservationId: 'r', actual: 30 }).state;
    expect(s.grants.find((g) => g.id === 'plan')!.remaining).toBe(70);
    expect(s.grants.find((g) => g.id === 'pack')!.remaining).toBe(50);
    const res = applyCreditOp(s, { type: 'expireGrants', now: 10_001 });
    expect(res.entries).toEqual([expect.objectContaining({ kind: 'EXPIRE', delta: -70 })]);
    expect(res.state.balance).toBe(50);
  });
});
