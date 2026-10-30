import type { FastifyRequest } from 'fastify';
import { AppError, moderateText } from '@sw/shared';
import { refusalUserHash } from '@sw/shared/node';
import type { Db, Tx } from '@sw/db';

export type RefusalPath = 'text' | 'image' | 'edit';

/** Log a refusal with a keyed hash of the requester (docs/policy-content.md). */
export async function logRefusal(db: Db | Tx, appSecret: string, who: string | null, a: { path: RefusalPath; surface: string; category: string }) {
  await db.contentRefusal.create({ data: { path: a.path, surface: a.surface, category: a.category.slice(0, 60), userHash: refusalUserHash(appSecret, who) } });
}

/** Refuse prohibited text on the server: neutral reason, no workaround, logged. */
export async function moderateOrRefuse(ctx: { db: Db; env: { APP_SECRET: string } }, req: FastifyRequest, text: string, surface: string, message = 'This request describes an item we do not make or print.') {
  const r = moderateText(text);
  if (r.ok) return;
  await logRefusal(ctx.db, ctx.env.APP_SECRET, req.auth.userId ?? req.auth.anonId, { path: 'text', surface, category: r.term ?? 'unknown' });
  throw new AppError('PROHIBITED_ITEM', message);
}
