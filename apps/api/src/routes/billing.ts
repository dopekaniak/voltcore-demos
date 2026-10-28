import type { FastifyInstance } from 'fastify';
import { AppError, authApi } from '@sw/shared';
import type { AppContext } from '../context';
import { decodeCursor, pageOf, route } from '../lib/route';
import { serializeLedger } from '../lib/serialize';

export function billingRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, authApi.getWallet, async (_i, req) => {
    const scope = { userId: req.auth.userId! };
    const w = await ctx.repos.wallet.get(scope);
    if (!w) throw new AppError('NOT_FOUND', 'Wallet not found');
    const grants = await ctx.repos.wallet.grants(scope);
    return {
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
      expiring: grants.filter((g) => g.expiresAt).map((g) => ({ amount: g.remaining, expires_at: g.expiresAt!.toISOString() })),
      plan: req.auth.planCode,
    };
  });

  route(app, ctx, authApi.getLedger, async ({ query }, req) => {
    const before = decodeCursor(query.cursor);
    const rows = await ctx.repos.wallet.ledger({ userId: req.auth.userId! }, { limit: query.limit + 1, ...(before ? { before } : {}) });
    return pageOf(rows, query.limit, (r) => r.id, serializeLedger);
  });
}
