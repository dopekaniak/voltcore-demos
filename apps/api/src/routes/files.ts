import type { FastifyInstance } from 'fastify';
import { AppError, jobsApi } from '@sw/shared';
import { verifyFsUrl } from '@sw/storage';
import type { fsStorage } from '@sw/storage';
import type { AppContext } from '../context';
import { idOr404, readableAsset } from '../lib/access';
import { route } from '../lib/route';

export function fileRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, jobsApi.fileUrl, async ({ params }, req) => {
    const { asset } = await readableAsset(ctx.db, req, idOr404(params.id.startsWith('frg_') ? 'forge' : 'asset', params.id, 'Asset'));
    const fileId = idOr404('file', params.file_id, 'File');
    const f = await ctx.db.assetFile.findUnique({ where: { id: fileId }, include: { assetVersion: true } });
    if (!f || f.assetVersion?.assetId !== asset.id) throw new AppError('NOT_FOUND', 'File not found');
    if (f.expiresAt && f.expiresAt <= ctx.now()) throw new AppError('NOT_FOUND', 'This export has expired; export it again');
    const ttl = 300;
    const url = await ctx.storage.signedGetUrl(f.storageKey, { filename: f.filename, contentType: f.contentType, ttlS: ttl });
    return { url, expires_at: new Date(ctx.now().getTime() + ttl * 1000).toISOString(), filename: f.filename, bytes: f.bytes };
  });

  // fs storage driver: serve signed GETs (ADR-009). S3 serves its own presigned URLs.
  app.get('/files/*', { config: { rateLimit: false } }, async (req, reply) => {
    if (ctx.storage.driver !== 'fs') throw new AppError('NOT_FOUND', 'Not found');
    const key = (req.params as { '*': string })['*'].split('/').map(decodeURIComponent).join('/');
    const q = req.query as Record<string, string | undefined>;
    const ok = q.op === 'get' && q.sig && verifyFsUrl(ctx.env.APP_SECRET, { op: 'get', key, exp: Number(q.exp), name: q.name, ct: q.ct }, q.sig, Math.floor(ctx.now().getTime() / 1000));
    if (!ok) throw new AppError('NOT_FOUND', 'Link is invalid or expired');
    const fs = ctx.storage as ReturnType<typeof fsStorage>;
    if ((await fs.size(key)) === null) throw new AppError('NOT_FOUND', 'Not found');
    reply.header('Content-Type', q.ct ?? 'application/octet-stream');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    if (q.name) reply.header('Content-Disposition', `attachment; filename="${q.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return reply.send(fs.openRead(key));
  });
}
