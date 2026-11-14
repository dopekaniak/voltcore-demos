import type { FastifyInstance } from 'fastify';
import { AppError, assertSameCurrency, printApi, toApiId } from '@sw/shared';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { serializeQuote, validateQuote } from '../lib/quote';
import { requireUser, route } from '../lib/route';

export function cartRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function cartFor(userId: string) {
    return ctx.db.cart.upsert({
      where: { ownerId: userId },
      update: {},
      create: { ownerId: userId },
    });
  }

  const checkQuote = (userId: string, quoteApiId: string) =>
    validateQuote(ctx, userId, idOr404('quote', quoteApiId, 'Quote'));

  async function render(userId: string) {
    const cart = await cartFor(userId);
    const items = await ctx.db.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' },
    });
    const quotes = await ctx.db.quote.findMany({
      where: { id: { in: items.map((i) => i.quoteId) } },
      include: { printPart: true },
    });
    const byId = new Map(quotes.map((q) => [q.id, q]));
    const rows = items.flatMap((i) => {
      const q = byId.get(i.quoteId);
      if (!q) return [];
      const sq = serializeQuote(ctx.env, q, ctx.now());
      return [
        {
          id: toApiId('cartItem', i.id),
          part_id: toApiId('part', i.printPartId),
          title: q.printPart.title,
          quote: sq,
          stale: sq.status !== 'ACTIVE',
        },
      ];
    });
    const subtotal = rows.reduce((a, r) => a + r.quote.subtotal_minor, 0);
    // One shipment per order: the most expensive method chosen in the cart applies once.
    const shipping = rows.length ? Math.max(...rows.map((r) => r.quote.shipping_minor)) : 0;
    return {
      id: toApiId('cart', cart.id),
      currency: cart.currency,
      items: rows,
      subtotal_minor: subtotal,
      shipping_minor: shipping,
      total_minor: subtotal + shipping,
      orderable: rows.length > 0 && rows.every((r) => !r.stale && r.quote.orderable),
    };
  }

  route(app, ctx, printApi.getCart, async (_i, req) => render(requireUser(req)));

  route(app, ctx, printApi.addCartItem, async ({ body }, req) => {
    const userId = requireUser(req);
    const q = await checkQuote(userId, body.quote_id);
    const cart = await cartFor(userId);
    const existing = await ctx.db.cartItem.findMany({
      where: { cartId: cart.id },
      include: { cart: true },
    });
    const quotes = await ctx.db.quote.findMany({
      where: { id: { in: existing.map((e) => e.quoteId) } },
    });
    try {
      assertSameCurrency([...quotes, q, { currency: cart.currency }]);
    } catch {
      throw new AppError('MIXED_CURRENCY', 'All items in a cart must use the same currency');
    }
    await ctx.db.cartItem.upsert({
      where: { cartId_printPartId: { cartId: cart.id, printPartId: q.printPartId } },
      update: { quoteId: q.id },
      create: { cartId: cart.id, printPartId: q.printPartId, quoteId: q.id },
    });
    return render(userId);
  });

  route(app, ctx, printApi.patchCartItem, async ({ params, body }, req) => {
    const userId = requireUser(req);
    const cart = await cartFor(userId);
    const item = await ctx.db.cartItem.findUnique({
      where: { id: idOr404('cartItem', params.id, 'Cart item') },
    });
    if (!item || item.cartId !== cart.id) throw new AppError('NOT_FOUND', 'Cart item not found');
    const q = await checkQuote(userId, body.quote_id);
    if (q.printPartId !== item.printPartId)
      throw new AppError('VALIDATION_FAILED', 'That quote is for a different part');
    await ctx.db.cartItem.update({ where: { id: item.id }, data: { quoteId: q.id } });
    return render(userId);
  });

  route(app, ctx, printApi.deleteCartItem, async ({ params }, req) => {
    const userId = requireUser(req);
    const cart = await cartFor(userId);
    const r = await ctx.db.cartItem.deleteMany({
      where: { id: idOr404('cartItem', params.id, 'Cart item'), cartId: cart.id },
    });
    if (!r.count) throw new AppError('NOT_FOUND', 'Cart item not found');
    return render(userId);
  });

  route(app, ctx, printApi.clearCart, async (_i, req) => {
    const cart = await cartFor(requireUser(req));
    await ctx.db.cartItem.deleteMany({ where: { cartId: cart.id } });
    return { ok: true as const };
  });
}
