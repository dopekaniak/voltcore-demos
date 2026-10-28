import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  forgeBuildMachine,
  jobMachine,
  orderItemMachine,
  orderMachine,
  qcFailureNext,
  reservationMachine,
  type Machine,
} from '../src/machines/index';

/** Expected edges written independently from the build prompt's section 10. */
const EXPECTED: [Machine<string>, string][] = [
  [jobMachine as Machine<string>, 'QUEUED>RUNNING QUEUED>CANCELED RUNNING>SUCCEEDED RUNNING>RETRYING RUNNING>FAILED RUNNING>CANCELED RETRYING>QUEUED RETRYING>FAILED'],
  [forgeBuildMachine as Machine<string>, 'DRAFT>AUTHORING DRAFT>FAILED AUTHORING>STATIC_CHECK AUTHORING>FAILED STATIC_CHECK>BUILDING STATIC_CHECK>AUTHORING STATIC_CHECK>FAILED BUILDING>VERIFYING BUILDING>AUTHORING BUILDING>FAILED VERIFYING>READY VERIFYING>AUTHORING VERIFYING>FAILED'],
  [orderMachine as Machine<string>, 'DRAFT>AWAITING_PAYMENT DRAFT>CANCELED AWAITING_PAYMENT>PAID AWAITING_PAYMENT>EXPIRED AWAITING_PAYMENT>CANCELED PAID>IN_PRODUCTION PAID>CANCELED PAID>REFUNDING IN_PRODUCTION>SHIPPED IN_PRODUCTION>ON_HOLD IN_PRODUCTION>REFUNDING ON_HOLD>IN_PRODUCTION ON_HOLD>REFUNDING SHIPPED>DELIVERED SHIPPED>REFUNDING DELIVERED>REFUNDING REFUNDING>REFUNDED REFUNDING>PARTIALLY_REFUNDED PARTIALLY_REFUNDED>REFUNDING'],
  [orderItemMachine as Machine<string>, 'QUEUED_FOR_PRINT>ROUTED ROUTED>PRINTING PRINTING>QC QC>PASSED QC>REWORK QC>ESCALATED REWORK>ROUTED PASSED>SHIPPED'],
  [reservationMachine as Machine<string>, 'RESERVED>COMMITTED RESERVED>RELEASED RESERVED>EXPIRED'],
];

describe.each(EXPECTED)('%s machine', (m, edges) => {
  const allowed = new Set(edges.split(' '));
  it('allows exactly the expected transitions (every pair checked)', () => {
    for (const from of m.states) {
      for (const to of m.states) {
        expect(canTransition(m, from, to), `${m.name} ${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });
  it('throws on an invalid transition', () => {
    const terminal = m.terminal[0]!;
    expect(() => assertTransition(m, terminal, m.states[0]!)).toThrow(/invalid transition/);
  });
});

describe('QC rework rule', () => {
  it('reworks twice, then escalates on the third failure', () => {
    expect(qcFailureNext(0)).toBe('REWORK');
    expect(qcFailureNext(1)).toBe('REWORK');
    expect(qcFailureNext(2)).toBe('ESCALATED');
  });
});
