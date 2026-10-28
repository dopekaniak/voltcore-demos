/**
 * Pure credit wallet core (ADR-005). The database service loads the locked wallet state,
 * applies one operation here, and writes the resulting ledger rows and state. Property
 * tests drive this function directly, and a smaller DB-backed property test checks that
 * the service and the database constraints agree.
 */

export type LedgerKind = 'GRANT' | 'PURCHASE' | 'RESERVE' | 'COMMIT' | 'RELEASE' | 'EXPIRE' | 'ADJUST' | 'REFUND';
export type GrantSource = 'PLAN' | 'PACK' | 'ADMIN' | 'SIGNUP';

export interface GrantState {
  id: string;
  source: GrantSource;
  amount: number;
  remaining: number;
  /** Epoch ms; null never expires. */
  expiresAt: number | null;
  createdAt: number;
}

export interface ReservationState {
  id: string;
  amount: number;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  committedAmount: number | null;
}

export interface WalletState {
  balance: number;
  reserved: number;
  grants: GrantState[];
  reservations: Record<string, ReservationState>;
}

export type CreditOp =
  | { type: 'grant'; grantId: string; source: GrantSource; amount: number; expiresAt: number | null; kind?: 'GRANT' | 'PURCHASE' | 'ADJUST' }
  | { type: 'reserve'; reservationId: string; amount: number }
  | { type: 'commit'; reservationId: string; actual: number }
  | { type: 'release'; reservationId: string }
  | { type: 'expireReservation'; reservationId: string }
  | { type: 'expireGrants'; now: number }
  | { type: 'debit'; amount: number; kind: 'ADJUST' | 'REFUND' };

export interface LedgerEntry {
  kind: LedgerKind;
  delta: number;
  reservedDelta: number;
  balanceAfter: number;
  reservedAfter: number;
  reservationId?: string;
  grantId?: string;
}

export interface CreditResult {
  state: WalletState;
  entries: LedgerEntry[];
  /** Grant rows whose remaining changed (id → new remaining), plus new grants. */
  grantChanges: Record<string, number>;
}

export class CreditError extends Error {
  constructor(
    readonly code: 'INSUFFICIENT_CREDITS' | 'INVALID_AMOUNT' | 'INVALID_STATE' | 'UNKNOWN_RESERVATION',
    message: string,
  ) {
    super(message);
    this.name = 'CreditError';
  }
}

const isPosInt = (n: number) => Number.isSafeInteger(n) && n > 0;
const isNonNegInt = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function emptyWallet(): WalletState {
  return { balance: 0, reserved: 0, grants: [], reservations: {} };
}

export function available(s: WalletState): number {
  return s.balance - s.reserved;
}

/** Spend order: soonest-expiring grants first, never-expiring last, oldest first on ties. */
function spendOrder(grants: GrantState[]): GrantState[] {
  return [...grants]
    .filter((g) => g.remaining > 0)
    .sort((a, b) => {
      const ea = a.expiresAt ?? Number.POSITIVE_INFINITY;
      const eb = b.expiresAt ?? Number.POSITIVE_INFINITY;
      return ea - eb || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
    });
}

function consume(grants: GrantState[], amount: number, changes: Record<string, number>): GrantState[] {
  let left = amount;
  const byId = new Map(grants.map((g) => [g.id, { ...g }]));
  for (const g of spendOrder(grants)) {
    if (left === 0) break;
    const take = Math.min(g.remaining, left);
    const row = byId.get(g.id)!;
    row.remaining -= take;
    changes[g.id] = row.remaining;
    left -= take;
  }
  if (left !== 0) throw new CreditError('INSUFFICIENT_CREDITS', 'grants do not cover the debit');
  return grants.map((g) => byId.get(g.id)!);
}

export function applyCreditOp(s: WalletState, op: CreditOp, now = 0): CreditResult {
  const changes: Record<string, number> = {};
  const entries: LedgerEntry[] = [];
  let state: WalletState = { ...s, grants: s.grants, reservations: { ...s.reservations } };
  const push = (e: Omit<LedgerEntry, 'balanceAfter' | 'reservedAfter'>) =>
    entries.push({ ...e, balanceAfter: state.balance, reservedAfter: state.reserved });

  switch (op.type) {
    case 'grant': {
      if (!isPosInt(op.amount)) throw new CreditError('INVALID_AMOUNT', 'grant must be a positive integer');
      const g: GrantState = { id: op.grantId, source: op.source, amount: op.amount, remaining: op.amount, expiresAt: op.expiresAt, createdAt: now };
      state = { ...state, balance: state.balance + op.amount, grants: [...state.grants, g] };
      changes[g.id] = g.remaining;
      push({ kind: op.kind ?? (op.source === 'PACK' ? 'PURCHASE' : op.source === 'ADMIN' ? 'ADJUST' : 'GRANT'), delta: op.amount, reservedDelta: 0, grantId: g.id });
      break;
    }
    case 'reserve': {
      if (!isNonNegInt(op.amount)) throw new CreditError('INVALID_AMOUNT', 'reserve must be a non-negative integer');
      if (state.reservations[op.reservationId]) throw new CreditError('INVALID_STATE', 'reservation exists');
      if (available(state) < op.amount) {
        throw new CreditError('INSUFFICIENT_CREDITS', `needs ${op.amount}, available ${available(state)}`);
      }
      state.reserved += op.amount;
      state.reservations[op.reservationId] = { id: op.reservationId, amount: op.amount, status: 'RESERVED', committedAmount: null };
      push({ kind: 'RESERVE', delta: 0, reservedDelta: op.amount, reservationId: op.reservationId });
      break;
    }
    case 'commit': {
      const r = state.reservations[op.reservationId];
      if (!r) throw new CreditError('UNKNOWN_RESERVATION', op.reservationId);
      if (r.status !== 'RESERVED') throw new CreditError('INVALID_STATE', `reservation is ${r.status}`);
      if (!isNonNegInt(op.actual) || op.actual > r.amount) {
        throw new CreditError('INVALID_AMOUNT', 'actual must be between 0 and the reserved amount');
      }
      state.reserved -= r.amount;
      state.balance -= op.actual;
      state.grants = consume(state.grants, op.actual, changes);
      state.reservations[r.id] = { ...r, status: 'COMMITTED', committedAmount: op.actual };
      push({ kind: 'COMMIT', delta: -op.actual, reservedDelta: -r.amount, reservationId: r.id });
      break;
    }
    case 'release':
    case 'expireReservation': {
      const r = state.reservations[op.reservationId];
      if (!r) throw new CreditError('UNKNOWN_RESERVATION', op.reservationId);
      if (r.status !== 'RESERVED') throw new CreditError('INVALID_STATE', `reservation is ${r.status}`);
      state.reserved -= r.amount;
      const status = op.type === 'release' ? 'RELEASED' : 'EXPIRED';
      state.reservations[r.id] = { ...r, status };
      push({ kind: 'RELEASE', delta: 0, reservedDelta: -r.amount, reservationId: r.id });
      break;
    }
    case 'expireGrants': {
      // Expire what is free; credits held by open reservations expire on a later sweep.
      for (const g of spendOrder(state.grants)) {
        if (g.expiresAt === null || g.expiresAt > op.now) continue;
        const x = Math.min(g.remaining, available(state));
        if (x <= 0) continue;
        state.balance -= x;
        state.grants = state.grants.map((row) => (row.id === g.id ? { ...row, remaining: row.remaining - x } : row));
        changes[g.id] = g.remaining - x;
        push({ kind: 'EXPIRE', delta: -x, reservedDelta: 0, grantId: g.id });
      }
      break;
    }
    case 'debit': {
      if (!isPosInt(op.amount)) throw new CreditError('INVALID_AMOUNT', 'debit must be a positive integer');
      if (available(state) < op.amount) throw new CreditError('INSUFFICIENT_CREDITS', `needs ${op.amount}`);
      state.balance -= op.amount;
      state.grants = consume(state.grants, op.amount, changes);
      push({ kind: op.kind, delta: -op.amount, reservedDelta: 0 });
      break;
    }
  }
  return { state, entries, grantChanges: changes };
}

/** Invariants checked by tests after every operation. */
export function checkInvariants(s: WalletState, ledgerSum: number): string[] {
  const problems: string[] = [];
  if (s.reserved < 0) problems.push('reserved < 0');
  if (s.balance < s.reserved) problems.push('balance < reserved');
  if (s.balance !== ledgerSum) problems.push(`balance ${s.balance} != ledger sum ${ledgerSum}`);
  const grantSum = s.grants.reduce((a, g) => a + g.remaining, 0);
  if (grantSum !== s.balance) problems.push(`grant sum ${grantSum} != balance ${s.balance}`);
  const openReserved = Object.values(s.reservations).filter((r) => r.status === 'RESERVED').reduce((a, r) => a + r.amount, 0);
  if (openReserved !== s.reserved) problems.push(`open reservations ${openReserved} != reserved ${s.reserved}`);
  return problems;
}
