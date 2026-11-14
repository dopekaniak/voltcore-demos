import { randomBytes } from 'node:crypto';
import { choosePrinter, enqueue, moveItem, moveOrder, type RoutePrinter } from '@sw/db';
import { toApiId, type OrderItemStatus } from '@sw/shared';
import type { WorkerContext } from '../context';

export interface OrderMessage {
  op: 'route' | 'advance';
  orderId: string;
}

const RETRY_ROUTE_MS = 30 * 60_000;

/**
 * Order work (build prompt 5.4, slice 8). `route` assigns each item to a partner printer once
 * the cancel window has passed. `advance` plays the mock partner: each step moves every item one
 * state (printing, QC, passed), then ships with a mock tracking number, then delivers. Real
 * partners will report these steps through their own interface; nothing here claims a real
 * partner exists.
 */
export async function processOrder(ctx: WorkerContext, msg: OrderMessage): Promise<void> {
  if (msg.op === 'route') return route(ctx, msg.orderId);
  return advance(ctx, msg.orderId);
}

async function route(ctx: WorkerContext, orderId: string): Promise<void> {
  const order = await ctx.db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.status !== 'PAID') return;
  const printers = await ctx.db.partnerPrinter.findMany({
    where: { partner: { status: 'ACTIVE' } },
    include: { partner: true },
  });
  const pool: (RoutePrinter & { isMock: boolean })[] = printers.map((p) => ({
    id: p.id,
    partnerId: p.partnerId,
    materials: p.materials,
    bedMm: p.bedMm as [number, number, number],
    queueMinutes: p.queueMinutes,
    active: p.status === 'ACTIVE',
    isMock: p.partner.isMock,
  }));
  const parts = await ctx.db.printPart.findMany({
    where: { id: { in: order.items.map((i) => i.printPartId) } },
  });
  const partOf = new Map(parts.map((p) => [p.id, p]));
  const quotes = await ctx.db.quote.findMany({
    where: { id: { in: order.items.map((i) => i.quoteId) } },
  });
  const printSeconds = new Map(
    quotes.map((q) => [
      q.id,
      (q.inputs as { estimate?: { print_time_s?: number } }).estimate?.print_time_s ?? 3600,
    ]),
  );
  const plan: { itemId: string; printer: RoutePrinter & { isMock: boolean }; minutes: number }[] =
    [];
  for (const item of order.items) {
    const s = item.settings as { material?: string; scale_pct?: number };
    const a = (partOf.get(item.printPartId)?.analysis ?? {}) as { bbox_mm?: number[] };
    const scale = (s.scale_pct ?? 100) / 100;
    const bbox = (a.bbox_mm ?? [0, 0, 0]).map((n) => n * scale) as [number, number, number];
    const p = choosePrinter(pool, { material: s.material ?? 'PLA', bboxMm: bbox });
    if (!p) {
      await ctx.db.orderEvent.create({
        data: {
          orderId,
          orderItemId: item.id,
          type: 'routing_failed',
          data: {
            note: `No printer can take ${item.title} in ${s.material ?? 'PLA'} right now; retrying`,
          },
        },
      });
      await enqueue(
        ctx.db,
        'order',
        `route:${orderId}:${Date.now()}`,
        { op: 'route', orderId },
        new Date(Date.now() + RETRY_ROUTE_MS),
      );
      return;
    }
    // The quote's per-unit print-time estimate, in minutes.
    const est = (printSeconds.get(item.quoteId) ?? 3600) / 60;
    const minutes = Math.round(est * item.quantity);
    plan.push({ itemId: item.id, printer: p, minutes });
    // Later items in the same order see the queue this one adds.
    p.queueMinutes += minutes;
  }
  await ctx.db.$transaction(async (tx) => {
    if (
      !(await moveOrder(tx, orderId, 'PAID', 'IN_PRODUCTION', {
        set: { routedAt: new Date() },
        data: { note: 'Sent to a print partner' },
      }))
    )
      return;
    for (const { itemId, printer, minutes } of plan) {
      const item = order.items.find((i) => i.id === itemId)!;
      await moveItem(
        tx,
        { id: item.id, orderId, status: item.status as OrderItemStatus },
        'ROUTED',
        {
          set: {
            partnerPrinterId: printer.id,
            partnerItemRef: `mock-${randomBytes(6).toString('hex')}`,
          },
        },
      );
      await tx.partnerPrinter.update({
        where: { id: printer.id },
        data: { queueMinutes: { increment: minutes } },
      });
    }
    if (plan.every((p) => p.printer.isMock))
      await enqueue(
        tx,
        'order',
        `advance:${orderId}:1`,
        { op: 'advance', orderId },
        new Date(Date.now() + ctx.env.MOCK_PARTNER_STEP_MS),
      );
  });
}

const NEXT: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
  ROUTED: 'PRINTING',
  PRINTING: 'QC',
  QC: 'PASSED',
};

async function advance(ctx: WorkerContext, orderId: string): Promise<void> {
  const order = await ctx.db.order.findUnique({
    where: { id: orderId },
    include: { items: true, owner: { select: { email: true } } },
  });
  if (!order) return;
  const ref = toApiId('order', order.id);
  const step = (await ctx.db.orderEvent.count({ where: { orderId } })) + 1;
  const again = (tx: Parameters<typeof enqueue>[0]) =>
    enqueue(
      tx,
      'order',
      `advance:${orderId}:${step}`,
      { op: 'advance', orderId },
      new Date(Date.now() + ctx.env.MOCK_PARTNER_STEP_MS),
    );
  if (order.status === 'IN_PRODUCTION') {
    await ctx.db.$transaction(async (tx) => {
      const items = order.items;
      if (items.every((i) => i.status === 'PASSED')) {
        const tracking = `MOCK${randomBytes(6).toString('hex').toUpperCase()}`;
        const at = new Date().toISOString();
        await tx.shipment.create({
          data: {
            orderId,
            carrier: 'Mock Carrier',
            trackingNumber: tracking,
            status: 'in_transit',
            events: [
              { status: 'label_created', at },
              { status: 'in_transit', at },
            ],
          },
        });
        for (const i of items)
          await moveItem(tx, { id: i.id, orderId, status: 'PASSED' }, 'SHIPPED');
        await moveOrder(tx, orderId, 'IN_PRODUCTION', 'SHIPPED', {
          data: { note: `Shipped with Mock Carrier, tracking ${tracking}` },
        });
        await enqueue(tx, 'email', `order-shipped:${orderId}`, {
          template: 'order-shipped',
          to: order.owner.email,
          vars: { order: ref, carrier: 'Mock Carrier', tracking },
        });
      } else {
        // Mock QC always passes; real partners report QC results (rework and escalation paths exist in the state machine).
        for (const i of items) {
          const to = NEXT[i.status as OrderItemStatus];
          if (to)
            await moveItem(tx, { id: i.id, orderId, status: i.status as OrderItemStatus }, to);
        }
      }
      await again(tx);
    });
  } else if (order.status === 'SHIPPED') {
    await ctx.db.$transaction(async (tx) => {
      const ship = await tx.shipment.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });
      if (ship)
        await tx.shipment.update({
          where: { id: ship.id },
          data: {
            status: 'delivered',
            events: [
              ...(ship.events as object[]),
              { status: 'delivered', at: new Date().toISOString() },
            ],
          },
        });
      await moveOrder(tx, orderId, 'SHIPPED', 'DELIVERED', { data: { note: 'Delivered' } });
      await enqueue(tx, 'email', `order-delivered:${orderId}`, {
        template: 'order-delivered',
        to: order.owner.email,
        vars: { order: ref },
      });
    });
  }
}
