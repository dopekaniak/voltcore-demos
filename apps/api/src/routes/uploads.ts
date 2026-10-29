import type { FastifyInstance } from 'fastify';
import { AppError, newId, uploadsApi } from '@sw/shared';
import { MeshServiceError, sha256Hex } from '@sw/shared/node';
import { verifyFsUrl, type fsStorage } from '@sw/storage';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { route } from '../lib/route';
import { serializeUpload } from '../lib/serialize';
import { ensureAnonId } from '../plugins/auth';

const ANON_TTL_MS = 24 * 3600_000;
const USER_TTL_MS = 30 * 24 * 3600_000;

/** Image signatures (magic bytes). */
function imageKind(b: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function uploadRoutes(app: FastifyInstance, ctx: AppContext): void {
  route(app, ctx, uploadsApi.createUpload, async ({ body }, req, reply) => {
    const purpose = body.purpose;
    const ext = body.filename.toLowerCase().split('.').pop() ?? '';
    const allowed = (uploadsApi.UPLOAD_TYPES[purpose] as Record<string, readonly string[]>)[ext];
    if (!allowed) throw new AppError('UPLOAD_REJECTED', `.${ext} files are not accepted here`, { allowed: Object.keys(uploadsApi.UPLOAD_TYPES[purpose]) });
    if (!allowed.includes(body.content_type)) throw new AppError('UPLOAD_REJECTED', `content type ${body.content_type} does not match .${ext}`);
    if (body.bytes > uploadsApi.UPLOAD_LIMITS[purpose]) throw new AppError('UPLOAD_REJECTED', `files must be ${uploadsApi.UPLOAD_LIMITS[purpose] / 1024 / 1024} MB or smaller`);
    const userId = req.auth.userId;
    const anonId = userId ? null : ensureAnonId(req, reply, ctx);
    const id = newId();
    const safe = body.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || `upload.${ext}`;
    const key = `quarantine/uploads/${id}/${safe}`;
    const u = await ctx.db.upload.create({
      data: {
        id,
        ownerId: userId,
        anonId,
        purpose: purpose === 'print' ? 'PRINT' : 'IMAGE',
        filename: safe,
        contentType: body.content_type,
        bytes: body.bytes,
        storageKey: key,
        expiresAt: new Date(ctx.now().getTime() + (userId ? USER_TTL_MS : ANON_TTL_MS)),
      },
    });
    const ttl = 15 * 60;
    const url = await ctx.storage.signedPutUrl(key, { contentType: body.content_type, contentLength: body.bytes, ttlS: ttl });
    return {
      upload: serializeUpload(u),
      put: { url, method: 'PUT' as const, headers: { 'content-type': body.content_type }, expires_at: new Date(ctx.now().getTime() + ttl * 1000).toISOString() },
    };
  });

  route(app, ctx, uploadsApi.completeUpload, async ({ params }, req) => {
    const id = idOr404('upload', params.id, 'Upload');
    const u = await ctx.db.upload.findUnique({ where: { id } });
    const mine = u && ((req.auth.userId && u.ownerId === req.auth.userId) || (!u.ownerId && req.auth.anonId && u.anonId === req.auth.anonId));
    if (!u || !mine) throw new AppError('NOT_FOUND', 'Upload not found');
    if (u.status === 'CLEAN' || u.status === 'REJECTED') return { upload: serializeUpload(u), analysis: null };
    const size = await ctx.storage.size(u.storageKey);
    const reject = async (reason: string) => {
      const r = await ctx.db.upload.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason } });
      await ctx.storage.delete(u.storageKey).catch(() => undefined);
      throw new AppError('UPLOAD_REJECTED', reason, { upload: serializeUpload(r) });
    };
    if (size === null) throw new AppError('INVALID_STATE', 'Upload the file before completing');
    if (size !== u.bytes) await reject(`the file is ${size} bytes, not the ${u.bytes} bytes declared`);
    await ctx.db.upload.update({ where: { id }, data: { status: 'SCANNING' } });
    const body = await ctx.storage.get(u.storageKey);
    let analysis: Record<string, unknown> | null = null;
    const ext = u.filename.toLowerCase().split('.').pop()!;
    if (u.purpose === 'IMAGE') {
      const kind = imageKind(body);
      if (!kind || (kind === 'jpg' ? !['jpg', 'jpeg'].includes(ext) : kind !== ext)) await reject('the file contents are not the image type its name says');
    } else {
      try {
        analysis = (await ctx.mesh.analyze(body, ext as 'stl' | 'obj' | '3mf')) as unknown as Record<string, unknown>;
      } catch (e) {
        if (e instanceof MeshServiceError && e.status === 422) await reject(e.message);
        throw new AppError('MESH_SERVICE_ERROR', 'The file could not be checked right now; try again');
      }
    }
    const cleanKey = u.storageKey.replace(/^quarantine\//, 'files/');
    await ctx.storage.move(u.storageKey, cleanKey);
    const done = await ctx.db.upload.update({ where: { id }, data: { status: 'CLEAN', storageKey: cleanKey, sha256: sha256Hex(body) } });
    return { upload: serializeUpload(done), analysis };
  });

  // fs driver: accept presigned PUTs (bound to content type and length).
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 151 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.put('/files/*', { bodyLimit: 151 * 1024 * 1024, config: { rateLimit: false } }, async (req, reply) => {
      if (ctx.storage.driver !== 'fs') throw new AppError('NOT_FOUND', 'Not found');
      const key = (req.params as { '*': string })['*'].split('/').map(decodeURIComponent).join('/');
      const q = req.query as Record<string, string | undefined>;
      const p = { op: 'put' as const, key, exp: Number(q.exp), ct: q.ct, len: q.len ? Number(q.len) : undefined };
      if (q.op !== 'put' || !q.sig || !verifyFsUrl(ctx.env.APP_SECRET, p, q.sig, Math.floor(ctx.now().getTime() / 1000)) || !key.startsWith('quarantine/')) {
        throw new AppError('FORBIDDEN', 'Upload link is invalid or expired');
      }
      const body = req.body as Buffer;
      if ((req.headers['content-type'] ?? '').split(';')[0] !== q.ct) throw new AppError('FORBIDDEN', 'Content-Type does not match the upload');
      if (!Buffer.isBuffer(body) || body.length !== p.len) throw new AppError('FORBIDDEN', 'Content-Length does not match the upload');
      await (ctx.storage as ReturnType<typeof fsStorage>).put(key, body, q.ct!);
      return reply.status(200).send({ ok: true });
    });
  });
}
