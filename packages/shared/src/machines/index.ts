import { defineMachine } from './machine';

export * from './machine';

/** Job: QUEUED → RUNNING → SUCCEEDED | RETRYING | FAILED | CANCELED; RETRYING → QUEUED | FAILED; QUEUED → CANCELED. */
export const jobMachine = defineMachine('job', {
  QUEUED: ['RUNNING', 'CANCELED'],
  RUNNING: ['SUCCEEDED', 'RETRYING', 'FAILED', 'CANCELED'],
  RETRYING: ['QUEUED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELED: [],
});
export type JobStatus = (typeof jobMachine.states)[number];

/** Forge build: DRAFT → AUTHORING → STATIC_CHECK → BUILDING → VERIFYING → READY; failure → FAILED. */
export const forgeBuildMachine = defineMachine('forgeBuild', {
  DRAFT: ['AUTHORING', 'FAILED'],
  // A repair attempt re-enters AUTHORING from a failed check or build.
  AUTHORING: ['STATIC_CHECK', 'FAILED'],
  STATIC_CHECK: ['BUILDING', 'AUTHORING', 'FAILED'],
  BUILDING: ['VERIFYING', 'AUTHORING', 'FAILED'],
  VERIFYING: ['READY', 'AUTHORING', 'FAILED'],
  READY: [],
  FAILED: [],
});
export type ForgeBuildState = (typeof forgeBuildMachine.states)[number];

const PAID_STATES = ['PAID', 'IN_PRODUCTION', 'ON_HOLD', 'SHIPPED', 'DELIVERED'] as const;

/** Order state machine (build prompt section 10). */
export const orderMachine = defineMachine('order', {
  DRAFT: ['AWAITING_PAYMENT', 'CANCELED'],
  AWAITING_PAYMENT: ['PAID', 'EXPIRED', 'CANCELED'],
  PAID: ['IN_PRODUCTION', 'CANCELED', 'REFUNDING'],
  IN_PRODUCTION: ['SHIPPED', 'ON_HOLD', 'REFUNDING'],
  ON_HOLD: ['IN_PRODUCTION', 'REFUNDING'],
  SHIPPED: ['DELIVERED', 'REFUNDING'],
  DELIVERED: ['REFUNDING'],
  REFUNDING: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  // A partial refund can be followed by further refunds.
  PARTIALLY_REFUNDED: ['REFUNDING'],
  REFUNDED: [],
  EXPIRED: [],
  CANCELED: [],
});
export type OrderStatus = (typeof orderMachine.states)[number];
export const ORDER_PAID_STATES: readonly OrderStatus[] = PAID_STATES;

/** Order item: QUEUED_FOR_PRINT → ROUTED → PRINTING → QC → PASSED → SHIPPED; QC → REWORK → ROUTED; ESCALATED. */
export const orderItemMachine = defineMachine('orderItem', {
  QUEUED_FOR_PRINT: ['ROUTED'],
  ROUTED: ['PRINTING'],
  PRINTING: ['QC'],
  QC: ['PASSED', 'REWORK', 'ESCALATED'],
  REWORK: ['ROUTED'],
  PASSED: ['SHIPPED'],
  SHIPPED: [],
  ESCALATED: [],
});
export type OrderItemStatus = (typeof orderItemMachine.states)[number];
export const MAX_REWORKS = 2;

/**
 * QC outcome for an item: a failure becomes REWORK until two reworks have happened; the
 * third failure escalates.
 */
export function qcFailureNext(reworkCount: number): 'REWORK' | 'ESCALATED' {
  return reworkCount < MAX_REWORKS ? 'REWORK' : 'ESCALATED';
}

/** Reservation: RESERVED → COMMITTED | RELEASED | EXPIRED. */
export const reservationMachine = defineMachine('reservation', {
  RESERVED: ['COMMITTED', 'RELEASED', 'EXPIRED'],
  COMMITTED: [],
  RELEASED: [],
  EXPIRED: [],
});
export type ReservationStatus = (typeof reservationMachine.states)[number];
