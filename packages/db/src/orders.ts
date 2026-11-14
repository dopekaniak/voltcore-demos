import { assertTransition, orderItemMachine, orderMachine, type OrderItemStatus, type OrderStatus } from '@sw/shared';
import type { Prisma } from '@prisma/client';
import type { Tx } from './index';

/**
 * Move an order to a new status: checked against the state machine, guarded on the current
 * status so concurrent callers cannot both move it, and recorded in the append-only events.
 * Returns false when another caller already moved it.
 */
export async function moveOrder(tx: Tx, orderId: string, from: OrderStatus, to: OrderStatus, a: { data?: Prisma.InputJsonValue; actorId?: string | null; set?: Prisma.OrderUpdateManyMutationInput } = {}): Promise<boolean> {
  assertTransition(orderMachine, from, to);
  const r = await tx.order.updateMany({ where: { id: orderId, status: from }, data: { status: to, ...(a.set ?? {}) } });
  if (r.count !== 1) return false;
  await tx.orderEvent.create({ data: { orderId, type: 'status', fromStatus: from, toStatus: to, ...(a.data !== undefined ? { data: a.data } : {}), actorId: a.actorId ?? null } });
  return true;
}

export async function moveItem(tx: Tx, item: { id: string; orderId: string; status: OrderItemStatus }, to: OrderItemStatus, a: { data?: Prisma.InputJsonValue; set?: Prisma.OrderItemUpdateManyMutationInput } = {}): Promise<boolean> {
  assertTransition(orderItemMachine, item.status, to);
  const r = await tx.orderItem.updateMany({ where: { id: item.id, status: item.status }, data: { status: to, ...(a.set ?? {}) } });
  if (r.count !== 1) return false;
  await tx.orderEvent.create({ data: { orderId: item.orderId, orderItemId: item.id, type: 'item_status', fromStatus: item.status, toStatus: to, ...(a.data !== undefined ? { data: a.data } : {}) } });
  return true;
}

export interface RoutePrinter {
  id: string;
  partnerId: string;
  materials: string[];
  bedMm: [number, number, number];
  queueMinutes: number;
  active: boolean;
}

/**
 * Partner routing (build prompt 5.4): a printer that is active, supports the material, and fits
 * the part in some upright orientation; among those, the shortest queue. Pure, for tests.
 */
export function choosePrinter<P extends RoutePrinter>(printers: P[], need: { material: string; bboxMm: [number, number, number] }): P | null {
  const [x, y, z] = need.bboxMm;
  const fits = (b: [number, number, number]) => z <= b[2] && ((x <= b[0] && y <= b[1]) || (y <= b[0] && x <= b[1]));
  const ok = printers.filter((p) => p.active && p.materials.includes(need.material) && fits(p.bedMm));
  ok.sort((a, b) => a.queueMinutes - b.queueMinutes || a.id.localeCompare(b.id));
  return ok[0] ?? null;
}
