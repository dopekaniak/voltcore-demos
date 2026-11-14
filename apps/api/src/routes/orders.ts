import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, formatMoney, newId, ordersApi, toApiId, type Currency } from '@sw/shared';
import {
  audit,
  enqueue,
  isUniqueViolation,
  moveOrder,
  type Order,
  type Prisma,
  type Quote,
  type Tx,
} from '@sw/db';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { gatewayFromEnv, MockGateway, type Gateway, type PaymentEvent } from '../lib/payments';
import { TAX_NOTE, validateQuote } from '../lib/quote';
import { decodeCursor, pageOf, requireUser, route } from '../lib/route';

interface QuoteLine {
  material: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
}

/**
 * Checkout and orders (build prompt 5.4, 5.5, slice 8). The server reprices every cart item;
 * an order becomes PAID only from a signed payment event whose amount and currency equal the
 * order total. Events are stored raw and processed once.
 */
export function orderRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  gateway: Gateway = gatewayFromEnv(ctx.env),
): void {
  async function detail(o: Order) {
    const [items, events, shipments] = await Promise.all([
      ctx.db.orderItem.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }),
      ctx.db.orderEvent.findMany({ where: { orderId: o.id }, orderBy: { seq: 'asc' } }),
      ctx.db.shipment.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const printers = await ctx.db.partnerPrinter.findMany({
      where: {
        id: { in: items.map((i) => i.partnerPrinterId).filter((x): x is string => Boolean(x)) },
      },
      include: { partner: true },
    });
    const city = new Map(printers.map((p) => [p.id, p.partner.city]));
    return {
      id: toApiId('order', o.id),
      status: o.status,
      total_minor: o.totalMinor,
      subtotal_minor: o.subtotalMinor,
      shipping_minor: o.shippingMinor,
      tax_minor: o.taxMinor,
      tax_note: TAX_NOTE,
      currency: o.currency,
      is_estimate: o.isEstimate,
      shipping_method: o.shippingMethod,
      address: o.address as never,
      created_at: o.createdAt.toISOString(),
      paid_at: o.paidAt ? o.paidAt.toISOString() : null,
      items: items.map((i) => ({
        id: toApiId('orderItem', i.id),
        title: i.title,
        quantity: i.quantity,
        unit_price_minor: i.unitPriceMinor,
        line_total_minor: i.lineTotalMinor,
        material: ((i.settings as { material?: string }).material ?? null) as string | null,
        status: i.status,
        // The partner's city, never internal ids (build prompt 5.4).
        partner_city: i.partnerPrinterId ? (city.get(i.partnerPrinterId) ?? null) : null,
      })),
      events: events.map((e) => ({
        type: e.type,
        from: e.fromStatus,
        to: e.toStatus,
        item_id: e.orderItemId ? toApiId('orderItem', e.orderItemId) : null,
        note: ((e.data as { note?: string } | null)?.note ?? null) as string | null,
        at: e.createdAt.toISOString(),
      })),
      shipments: shipments.map((s) => ({
        carrier: s.carrier,
        tracking_number: s.trackingNumber,
        status: s.status,
        events: s.events as never,
      })),
      can_cancel: o.status === 'AWAITING_PAYMENT' || (o.status === 'PAID' && !o.routedAt),
      checkout_url:
        o.status === 'AWAITING_PAYMENT' && gateway.mode === 'mock' && o.stripeSessionId
          ? `${ctx.env.WEB_ORIGIN}/checkout/mock?session=${o.stripeSessionId}`
          : null,
      payments_mode: gateway.mode,
    };
  }

  async function ownOrder(req: FastifyRequest, apiId: string) {
    const userId = requireUser(req);
    const o = await ctx.db.order.findUnique({ where: { id: idOr404('order', apiId, 'Order') } });
    if (!o || o.ownerId !== userId) throw new AppError('NOT_FOUND', 'Order not found');
    return o;
  }

  route(app, ctx, ordersApi.checkout, async ({ body, idempotencyKey }, req) => {
    const userId = requireUser(req);
    if (!(ordersApi.SHIP_COUNTRIES as readonly string[]).includes(body.address.country))
      throw new AppError('VALIDATION_FAILED', 'We ship to the United States only for now');
    const cart = await ctx.db.cart.findUnique({
      where: { ownerId: userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!cart || cart.items.length === 0) throw new AppError('INVALID_STATE', 'Your cart is empty');
    // Reprice every item on the server; a changed price stops checkout with the new quote.
    const quotes: Quote[] = [];
    for (const item of cart.items) quotes.push(await validateQuote(ctx, userId, item.quoteId));
    if (quotes.some((q) => q.isEstimate) && ctx.env.ESTIMATE_ORDERS !== 'allow-dev')
      throw new AppError(
        'ESTIMATE_NOT_ORDERABLE',
        'These prices are estimates and cannot be ordered yet',
      );
    const currency = quotes[0]!.currency;
    if (quotes.some((q) => q.currency !== currency))
      throw new AppError('MIXED_CURRENCY', 'All items must use the same currency');
    const subtotal = quotes.reduce((n, q) => n + q.subtotalMinor, 0);
    // One shipment per order: the most expensive method in the cart applies once (as the cart shows).
    const shipping = Math.max(...quotes.map((q) => q.shippingMinor));
    const tax = quotes.reduce((n, q) => n + q.taxMinor, 0);
    const total = subtotal + shipping + tax;
    const titles = await ctx.db.printPart.findMany({
      where: { id: { in: quotes.map((q) => q.printPartId) } },
      select: { id: true, title: true },
    });
    const title = new Map(titles.map((p) => [p.id, p.title]));
    const orderId = newId();
    const order = await ctx.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { termsVersion: ctx.env.TERMS_VERSION, termsAcceptedAt: ctx.now() },
      });
      const { country, postal_code, ...rest } = body.address;
      await tx.address.create({
        data: {
          ownerId: userId,
          ...rest,
          line2: rest.line2 ?? null,
          phone: rest.phone ?? null,
          postalCode: postal_code,
          country,
        },
      });
      const o = await tx.order.create({
        data: {
          id: orderId,
          ownerId: userId,
          status: 'DRAFT',
          subtotalMinor: subtotal,
          shippingMinor: shipping,
          taxMinor: tax,
          totalMinor: total,
          currency,
          shippingMethod:
            (quotes[0]!.inputs as { settings?: { shipping?: string } }).settings?.shipping ??
            'standard',
          address: body.address,
          termsVersion: ctx.env.TERMS_VERSION,
          isEstimate: quotes.some((q) => q.isEstimate),
          idempotencyKey: idempotencyKey!,
        },
      });
      await tx.orderItem.createMany({
        data: quotes.map((q) => {
          const l = (q.lines as unknown as QuoteLine[])[0]!;
          return {
            orderId,
            quoteId: q.id,
            printPartId: q.printPartId,
            title: title.get(q.printPartId) ?? 'Part',
            quantity: l.quantity,
            unitPriceMinor: l.unit_price_minor,
            lineTotalMinor: q.subtotalMinor,
            settings: (q.inputs as { settings: Prisma.InputJsonValue }).settings,
          };
        }),
      });
      await tx.orderEvent.create({
        data: { orderId, type: 'created', toStatus: 'DRAFT', actorId: userId },
      });
      return o;
    });
    let session: { id: string; url: string };
    try {
      session = await gateway.createSession({
        orderId: toApiId('order', orderId),
        currency,
        lines: [
          ...quotes.map((q) => ({
            name: title.get(q.printPartId) ?? 'Printed part',
            unitAmountMinor: q.subtotalMinor + q.taxMinor,
            quantity: 1,
          })),
          ...(shipping ? [{ name: 'Shipping', unitAmountMinor: shipping, quantity: 1 }] : []),
        ],
        successUrl: `${ctx.env.WEB_ORIGIN}/orders/${toApiId('order', orderId)}?checkout=success`,
        cancelUrl: `${ctx.env.WEB_ORIGIN}/cart`,
        idempotencyKey: `checkout:${orderId}`,
      });
    } catch (e) {
      await ctx.db.$transaction((tx) =>
        moveOrder(tx, orderId, 'DRAFT', 'CANCELED', { data: { note: 'Payment could not start' } }),
      );
      throw e;
    }
    await ctx.db.$transaction(async (tx) => {
      await moveOrder(tx, orderId, 'DRAFT', 'AWAITING_PAYMENT', {
        set: { stripeSessionId: session.id },
      });
      await tx.payment.create({
        data: {
          ownerId: userId,
          kind: 'ORDER',
          amountMinor: total,
          currency,
          stripeSessionId: session.id,
          orderId,
          idempotencyKey: `order:${orderId}`,
        },
      });
    });
    return {
      order: await detail(await ctx.db.order.findUniqueOrThrow({ where: { id: order.id } })),
      checkout_url: session.url,
    };
  });

  route(app, ctx, ordersApi.listOrders, async ({ query }, req) => {
    const userId = requireUser(req);
    const before = decodeCursor(query.cursor);
    const rows = await ctx.db.order.findMany({
      where: {
        ownerId: userId,
        status: { not: 'DRAFT' },
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: { _count: { select: { items: true } } },
    });
    return pageOf(
      rows,
      query.limit,
      (r) => r.id,
      (o) => ({
        id: toApiId('order', o.id),
        status: o.status,
        total_minor: o.totalMinor,
        currency: o.currency,
        items: o._count.items,
        is_estimate: o.isEstimate,
        created_at: o.createdAt.toISOString(),
        paid_at: o.paidAt ? o.paidAt.toISOString() : null,
      }),
    );
  });

  route(app, ctx, ordersApi.getOrder, async ({ params }, req) =>
    detail(await ownOrder(req, params.id)),
  );

  route(app, ctx, ordersApi.cancelOrder, async ({ params }, req) => {
    const o = await ownOrder(req, params.id);
    if (o.status === 'AWAITING_PAYMENT') {
      await ctx.db.$transaction(async (tx) => {
        if (
          await moveOrder(tx, o.id, 'AWAITING_PAYMENT', 'CANCELED', {
            actorId: o.ownerId,
            data: { note: 'Canceled before payment' },
          })
        )
          await tx.payment.updateMany({
            where: { orderId: o.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
      });
    } else if (o.status === 'PAID' && !o.routedAt) {
      const payment = await ctx.db.payment.findFirstOrThrow({
        where: { orderId: o.id, status: 'SUCCEEDED' },
      });
      const refund = await gateway.refund(
        payment.stripePaymentIntentId,
        payment.amountMinor,
        `refund:cancel:${o.id}`,
      );
      await ctx.db.$transaction(async (tx) => {
        if (
          !(await moveOrder(tx, o.id, 'PAID', 'CANCELED', {
            actorId: o.ownerId,
            data: { note: 'Canceled by the buyer; refunded in full' },
          }))
        )
          return;
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED', refundedMinor: payment.amountMinor },
        });
        await tx.refund.create({
          data: {
            paymentId: payment.id,
            orderId: o.id,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            reason: 'Buyer canceled within the cancel window',
            status: 'SUCCEEDED',
            requestedById: o.ownerId,
            idempotencyKey: `refund:cancel:${o.id}`,
            stripeRefundId: refund.id,
          },
        });
        await audit(tx, {
          actorId: o.ownerId,
          action: 'order.cancel_refund',
          targetType: 'order',
          targetId: o.id,
          data: { amount_minor: payment.amountMinor },
          requestId: req.id,
        });
      });
    } else
      throw new AppError(
        'INVALID_STATE',
        'This order can no longer be canceled; report a problem instead',
      );
    return detail(await ctx.db.order.findUniqueOrThrow({ where: { id: o.id } }));
  });

  // ───────────── payment events ─────────────

  async function processEvent(e: PaymentEvent): Promise<{ duplicate: boolean }> {
    return ctx.db.$transaction(async (tx) => {
      try {
        await tx.stripeEventRaw.create({
          data: { id: e.id, type: e.type, payload: e as unknown as Prisma.InputJsonValue },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { duplicate: true };
        throw err;
      }
      const s = e.data.object;
      const order = await tx.order.findUnique({ where: { stripeSessionId: s.id } });
      if (order) {
        if (e.type === 'checkout.session.completed') await onPaid(tx, order, s);
        else if (
          e.type === 'checkout.session.expired' &&
          (await moveOrder(tx, order.id, 'AWAITING_PAYMENT', 'EXPIRED', {
            data: { note: 'Payment was not completed' },
          }).catch(() => false))
        ) {
          await tx.payment.updateMany({
            where: { orderId: order.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
        }
      }
      await tx.stripeEventRaw.update({ where: { id: e.id }, data: { processedAt: ctx.now() } });
      return { duplicate: false };
    });
  }

  async function onPaid(tx: Tx, order: Order, s: PaymentEvent['data']['object']) {
    if (order.status !== 'AWAITING_PAYMENT') return;
    // PAID only when the provider's amount and currency equal what we charged (build prompt 12).
    const matches =
      s.payment_status === 'paid' &&
      s.amount_total === order.totalMinor &&
      (s.currency ?? '').toUpperCase() === order.currency;
    if (!matches) {
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment_mismatch',
          data: {
            note: 'Payment did not match the order total',
            amount_total: s.amount_total ?? null,
            currency: s.currency ?? null,
            payment_status: s.payment_status ?? null,
          },
        },
      });
      await audit(tx, {
        actorId: null,
        action: 'order.payment_mismatch',
        targetType: 'order',
        targetId: order.id,
        data: { expected: order.totalMinor, got: s.amount_total ?? null },
      });
      return;
    }
    const now = ctx.now();
    await moveOrder(tx, order.id, 'AWAITING_PAYMENT', 'PAID', {
      set: { paidAt: now },
      data: { note: 'Payment received' },
    });
    await tx.payment.updateMany({
      where: { orderId: order.id, stripeSessionId: s.id },
      data: { status: 'SUCCEEDED', stripePaymentIntentId: s.payment_intent ?? null },
    });
    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    await tx.quote.updateMany({
      where: { id: { in: items.map((i) => i.quoteId) } },
      data: { status: 'ORDERED' },
    });
    await tx.cartItem.deleteMany({
      where: {
        cart: { ownerId: order.ownerId },
        printPartId: { in: items.map((i) => i.printPartId) },
      },
    });
    const owner = await tx.user.findUniqueOrThrow({
      where: { id: order.ownerId },
      select: { email: true },
    });
    const ref = toApiId('order', order.id);
    await enqueue(tx, 'email', `order-paid:${order.id}`, {
      template: 'order-paid',
      to: owner.email,
      vars: { order: ref, total: formatMoney(order.totalMinor, order.currency as Currency) },
    });
    // Routing waits out the cancel window (refund in full until then).
    await enqueue(
      tx,
      'order',
      `route:${order.id}`,
      { op: 'route', orderId: order.id },
      new Date(now.getTime() + ctx.env.ORDER_ROUTE_DELAY_MS),
    );
  }

  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.post(
      ordersApi.paymentWebhook.path,
      { config: { rateLimit: false } },
      async (req, reply) => {
        const sig = req.headers['stripe-signature'];
        const e = gateway.verify(req.body as Buffer, typeof sig === 'string' ? sig : undefined);
        if (!e) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature check failed');
        const r = await processEvent(e);
        return reply.status(200).send({ received: true, duplicate: r.duplicate });
      },
    );
  });

  // ───────────── mock payment page (PAYMENTS_MODE=mock) ─────────────

  async function mockOrder(req: FastifyRequest, sessionId: string) {
    if (!(gateway instanceof MockGateway)) throw new AppError('NOT_FOUND', 'Not found');
    const userId = requireUser(req);
    const o = await ctx.db.order.findUnique({ where: { stripeSessionId: sessionId } });
    if (!o || o.ownerId !== userId) throw new AppError('NOT_FOUND', 'Payment session not found');
    return { o, mock: gateway };
  }
  route(app, ctx, ordersApi.mockSession, async ({ params }, req) => {
    const { o } = await mockOrder(req, params.id);
    return {
      id: params.id,
      order_id: toApiId('order', o.id),
      amount_minor: o.totalMinor,
      currency: o.currency,
      status: o.status,
    };
  });
  route(app, ctx, ordersApi.mockComplete, async ({ params, body }, req) => {
    const { o, mock } = await mockOrder(req, params.id);
    const ev = mock.event(
      body.outcome === 'paid' ? 'checkout.session.completed' : 'checkout.session.expired',
      {
        id: params.id,
        amount_total: o.totalMinor,
        currency: o.currency.toLowerCase(),
        payment_status: body.outcome === 'paid' ? 'paid' : 'unpaid',
        payment_intent:
          body.outcome === 'paid' ? `mpi_${o.id.replace(/-/g, '')}` : null,
        client_reference_id: toApiId('order', o.id),
      },
    );
    // Through the real webhook route, so the mock exercises signature checks and dedupe.
    const res = await app.inject({
      method: 'POST',
      url: ordersApi.paymentWebhook.path,
      headers: { 'content-type': 'application/json', 'stripe-signature': ev.signature },
      payload: ev.raw,
    });
    if (res.statusCode !== 200)
      throw new AppError('INTERNAL', 'The test payment could not be recorded');
    const now = await ctx.db.order.findUniqueOrThrow({ where: { id: o.id } });
    return { order_id: toApiId('order', o.id), status: now.status };
  });
}
