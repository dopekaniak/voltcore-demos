import type { FastifyInstance } from 'fastify';
import { AppError, authApi } from '@sw/shared';
import { decrypt, encrypt, newTotpSecret, randomToken, sha256Hex, verifyTotp } from '@sw/shared/node';
import { audit, claimAnonymous, enqueue, onboardUser } from '@sw/db';
import type { AppContext } from '../context';
import { route } from '../lib/route';
import { serializeUser } from '../lib/serialize';
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_MS } from '../plugins/auth';

const MAGIC_LINK_TTL_MS = 15 * 60_000;

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, authApi.magicLinkRequest, async ({ body }, req) => {
    const token = randomToken(32);
    const email = body.email.trim().toLowerCase();
    const link = await ctx.db.$transaction(async (tx) => {
      const ml = await tx.magicLink.create({
        data: {
          email,
          tokenHash: sha256Hex(token),
          anonId: req.auth.anonId,
          redirectTo: body.redirect_to ?? null,
          expiresAt: new Date(ctx.now().getTime() + MAGIC_LINK_TTL_MS),
        },
      });
      const url = `${ctx.env.WEB_ORIGIN}/auth/callback?token=${encodeURIComponent(token)}`;
      await enqueue(tx, 'email', `magic-link:${ml.id}`, { template: 'magic-link', to: email, vars: { url } });
      return { id: ml.id, url };
    });
    if (ctx.env.NODE_ENV === 'development') req.log.info({ magicLink: link.url }, 'magic link (development only)');
    return { ok: true as const };
  });

  route(app, ctx, authApi.magicLinkConsume, async ({ body }, req, reply) => {
    const now = ctx.now();
    const result = await ctx.db.$transaction(async (tx) => {
      const ml = await tx.magicLink.findUnique({ where: { tokenHash: sha256Hex(body.token) } });
      if (!ml || ml.consumedAt || ml.expiresAt <= now) throw new AppError('MAGIC_LINK_INVALID', 'This sign-in link is invalid or has expired');
      // Single use: the conditional update fails for a concurrent second consumer.
      const used = await tx.magicLink.updateMany({ where: { id: ml.id, consumedAt: null }, data: { consumedAt: now } });
      if (used.count !== 1) throw new AppError('MAGIC_LINK_INVALID', 'This sign-in link has already been used');
      const bootstrap = ctx.env.BOOTSTRAP_ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const { userId, created } = await onboardUser(tx, { email: ml.email, role: bootstrap.includes(ml.email.toLowerCase()) ? 'ADMIN' : 'USER', now });
      // Rotate: revoke whatever session this browser held before.
      if (req.auth.sessionId) await tx.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: now } });
      const token = randomToken(32);
      await tx.session.create({
        data: {
          userId,
          tokenHash: sha256Hex(token),
          ip: req.ip,
          userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
      const anon = ml.anonId ?? req.auth.anonId;
      const claimed = anon ? await claimAnonymous(tx, userId, anon) : 0;
      await audit(tx, { actorId: userId, action: created ? 'user.signup' : 'user.login', targetType: 'user', targetId: userId, ip: req.ip, requestId: req.id });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      return { token, user, claimed, redirectTo: ml.redirectTo };
    });
    reply.setCookie(SESSION_COOKIE, result.token, cookieOptions(ctx, SESSION_TTL_MS / 1000));
    const sub = await ctx.db.subscription.findFirst({ where: { ownerId: result.user.id }, include: { plan: true }, orderBy: { createdAt: 'desc' } });
    return { user: serializeUser(result.user, sub?.plan.code ?? 'free'), redirect_to: result.redirectTo, claimed: result.claimed };
  });

  route(app, ctx, authApi.logout, async (_i, req, reply) => {
    await ctx.db.session.update({ where: { id: req.auth.sessionId! }, data: { revokedAt: ctx.now() } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true as const };
  });

  route(app, ctx, authApi.totpSetup, async (_i, req) => {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: req.auth.userId! } });
    if (user.totpEnabledAt) throw new AppError('INVALID_STATE', 'TOTP is already enabled');
    const secret = newTotpSecret();
    await ctx.db.user.update({ where: { id: user.id }, data: { totpSecretEnc: encrypt(ctx.env.APP_SECRET, 'totp', secret) } });
    const label = encodeURIComponent(`Shapewright:${user.email}`);
    return { otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=Shapewright&digits=6&period=30`, secret };
  });

  route(app, ctx, authApi.totpVerify, async ({ body }, req) => {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: req.auth.userId! } });
    if (!user.totpSecretEnc) throw new AppError('INVALID_STATE', 'Start TOTP setup first');
    const secret = decrypt(ctx.env.APP_SECRET, 'totp', user.totpSecretEnc);
    if (!verifyTotp(secret, body.code, ctx.now().getTime())) throw new AppError('TOTP_INVALID', 'That code is not valid');
    await ctx.db.$transaction(async (tx) => {
      if (!user.totpEnabledAt) await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: ctx.now() } });
      await tx.session.update({ where: { id: req.auth.sessionId! }, data: { totpVerifiedAt: ctx.now() } });
      await audit(tx, { actorId: user.id, action: 'user.totp_verified', targetType: 'user', targetId: user.id, requestId: req.id });
    });
    return { ok: true as const };
  });

  route(app, ctx, authApi.getMe, async (_i, req) => {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: req.auth.userId! } });
    return serializeUser(user, req.auth.planCode);
  });

  route(app, ctx, authApi.patchMe, async ({ body }, req) => {
    if (body.accept_terms_version && body.accept_terms_version !== ctx.env.TERMS_VERSION) {
      throw new AppError('VALIDATION_FAILED', `Current terms version is ${ctx.env.TERMS_VERSION}`);
    }
    const user = await ctx.db.user.update({
      where: { id: req.auth.userId! },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.accept_terms_version ? { termsVersion: body.accept_terms_version, termsAcceptedAt: ctx.now() } : {}),
      },
    });
    return serializeUser(user, req.auth.planCode);
  });
}
