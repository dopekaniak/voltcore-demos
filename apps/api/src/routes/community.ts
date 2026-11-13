import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, communityApi, fromApiId, newId, toApiId } from '@sw/shared';
import { MeshServiceError, sha256Hex } from '@sw/shared/node';
import { audit, Prisma, type Asset, type AssetFile } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { licenseBlock } from '../lib/catalog';
import { cards, loadVisibleModel, MESH_ROLES, modelApiId, modelIdOf, relevance, RANKING, RESERVED_HANDLES, signed } from '../lib/community';
import { moderateOrRefuse } from '../lib/moderation';
import { requireUser, route } from '../lib/route';

const MAX_PHOTOS = 10;
const UPLOAD_ROLE = { stl: 'STL', obj: 'OBJ', '3mf': 'THREEMF' } as const;
const UPLOAD_CT = { stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf' } as const;

/** Offset cursors: rankings are not ordered by id, so pages continue by position. */
const offsetOf = (cursor?: string) => {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new AppError('VALIDATION_FAILED', 'invalid cursor');
  return n;
};

/**
 * Community model library (Module 8, ADR-045). Shared models are library assets with a license
 * and a published page. Search reads only our own database: no request leaves the platform.
 */
export function communityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const viewer = (req: FastifyRequest) => req.auth.userId ?? null;
  const moderate = (req: FastifyRequest, text: string, surface: string) => moderateOrRefuse(ctx, req, text, surface);

  async function licenseOf(a: Asset) {
    const ml = await ctx.db.modelLicense.findUnique({ where: { assetId: a.id }, include: { license: true } });
    return ml;
  }

  async function detail(a: Asset, viewerId: string | null) {
    const [ml, owner, version, photos, parent, remixes, followers, models] = await Promise.all([
      licenseOf(a),
      ctx.db.user.findUniqueOrThrow({ where: { id: a.ownerId }, select: { handle: true, name: true } }),
      a.currentVersionId ? ctx.db.assetVersion.findUnique({ where: { id: a.currentVersionId }, include: { files: true } }) : null,
      ctx.db.assetFile.findMany({ where: { role: 'PHOTO', assetVersion: { assetId: a.id } }, orderBy: { createdAt: 'asc' } }),
      a.forkedFromId ? ctx.db.asset.findUnique({ where: { id: a.forkedFromId } }) : null,
      ctx.db.asset.findMany({ where: { forkedFromId: a.id, publishStatus: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null }, orderBy: { publishedAt: 'desc' }, take: 20 }),
      ctx.db.follow.count({ where: { creatorId: a.ownerId } }),
      ctx.db.asset.count({ where: { ownerId: a.ownerId, publishStatus: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null } }),
    ]);
    const [liked, saved, following] = viewerId
      ? await Promise.all([
          ctx.db.assetLike.findUnique({ where: { userId_assetId: { userId: viewerId, assetId: a.id } } }),
          ctx.db.assetSave.findUnique({ where: { userId_assetId: { userId: viewerId, assetId: a.id } } }),
          ctx.db.follow.findUnique({ where: { followerId_creatorId: { followerId: viewerId, creatorId: a.ownerId } } }),
        ])
      : [null, null, null];
    const lineage = async (x: Asset) => ({ id: modelApiId(x.id), title: x.title, creator: (await ctx.db.user.findUnique({ where: { id: x.ownerId }, select: { handle: true } }))?.handle ?? 'unknown', license_code: x.license });
    const parentVisible = parent && !parent.deletedAt && parent.publishStatus === 'PUBLISHED' ? parent : null;
    const [base] = await cards(ctx.db, ctx.storage, [a]);
    const files = (version?.files ?? []).filter((f) => (MESH_ROLES as readonly string[]).includes(f.role) && (!f.expiresAt || f.expiresAt > new Date()));
    const pub = (f: AssetFile) => ({ id: toApiId('file', f.id), role: f.role, filename: f.filename, content_type: f.contentType, bytes: f.bytes });
    const view = files.find((f) => f.role === 'GLB') ?? files.find((f) => f.role === 'STL' || f.role === 'PREVIEW_MESH') ?? null;
    const author = owner.handle ?? owner.name ?? 'a creator';
    const license = ml
      ? licenseBlock(ml.license, ml, { title: a.title, author })
      : { code: a.license, name: 'No license chosen', attribution: `${a.title} by ${author}`, allows_print_order: false, allows_derivatives: false, allows_commercial: false };
    return {
      ...base!,
      description: a.description,
      print_notes: (a.printNotes ?? null) as Record<string, never> | null,
      publish_status: a.publishStatus,
      listed: a.listed,
      review_note: viewerId === a.ownerId ? a.reviewNote : null,
      license,
      creator: { handle: owner.handle ?? 'unknown', name: owner.name, followers, models },
      files: files.map(pub),
      photos: await Promise.all(photos.map(async (p) => ({ ...pub(p), url: await signed(ctx.storage, p) }))),
      view: view ? { url: await signed(ctx.storage, view), format: view.role === 'GLB' ? ('glb' as const) : ('stl' as const) } : null,
      bbox_mm: (version?.bboxMm ?? null) as number[] | null,
      triangles: version?.triangles ?? null,
      remix_of: parentVisible ? await lineage(parentVisible) : null,
      remixes: await Promise.all(remixes.map(lineage)),
      is_owner: viewerId === a.ownerId,
      liked: Boolean(liked),
      saved: Boolean(saved),
      following: Boolean(following),
    };
  }

  // ───────────── search and browse ─────────────

  route(app, ctx, communityApi.searchModels, async ({ query }) => {
    const and: Prisma.AssetWhereInput[] = [{ publishStatus: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null }];
    if (query.category) and.push({ category: query.category });
    if (query.tag) and.push({ tags: { has: query.tag } });
    if (query.license) and.push({ license: query.license });
    if (query.printable === 'true') and.push({ needsRepair: false });
    if (query.creator) and.push({ owner: { handle: { equals: query.creator, mode: 'insensitive' } } });
    if (query.file_type) {
      const roles: Prisma.AssetFileWhereInput['role'][] = query.file_type === 'stl' ? ['STL', 'PREVIEW_MESH'] : [({ '3mf': 'THREEMF', obj: 'OBJ', glb: 'GLB' } as const)[query.file_type]];
      and.push({ versions: { some: { files: { some: { role: { in: roles as never } } } } } });
    }
    if (query.remixable === 'true') {
      const codes = (await ctx.db.licenseTerms.findMany({ where: { allowsDerivatives: true, isCustom: false }, select: { code: true } })).map((l) => l.code);
      and.push({ license: { in: codes } });
    }
    const q = query.q?.toLowerCase();
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } },
          { owner: { handle: { equals: q, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.AssetWhereInput = { AND: and };
    const offset = offsetOf(query.cursor);
    let rows: Asset[];
    if (q && query.sort === 'relevance') {
      const candidates = await ctx.db.asset.findMany({ where, orderBy: { publishedAt: 'desc' }, take: RANKING.candidateLimit, include: { owner: { select: { handle: true } } } });
      const scored = candidates.map((a) => ({ a, s: relevance(a, a.owner.handle, q) })).sort((x, y) => y.s - x.s || (y.a.publishedAt?.getTime() ?? 0) - (x.a.publishedAt?.getTime() ?? 0));
      rows = scored.slice(offset, offset + query.limit + 1).map(({ a }) => a);
    } else {
      const orderBy: Prisma.AssetOrderByWithRelationInput[] =
        query.sort === 'downloads' ? [{ downloadCount: 'desc' }, { publishedAt: 'desc' }] : query.sort === 'likes' ? [{ likeCount: 'desc' }, { publishedAt: 'desc' }] : [{ publishedAt: 'desc' }, { id: 'desc' }];
      rows = await ctx.db.asset.findMany({ where, orderBy, skip: offset, take: query.limit + 1 });
    }
    const page = rows.slice(0, query.limit);
    let suggested: string[] = [];
    if (page.length === 0) {
      const tags = await ctx.db.$queryRaw<{ tag: string }[]>`
        SELECT t AS tag FROM assets, unnest(tags) AS t
        WHERE publish_status = 'PUBLISHED' AND visibility = 'PUBLIC' AND deleted_at IS NULL
        GROUP BY t ORDER BY count(*) DESC, t LIMIT 8`;
      suggested = tags.map((t) => t.tag);
    }
    return { data: await cards(ctx.db, ctx.storage, page), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null, suggested_tags: suggested };
  });

  route(app, ctx, communityApi.listCategories, async () => {
    const counts = await ctx.db.asset.groupBy({ by: ['category'], where: { publishStatus: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null }, _count: { _all: true } });
    const by = new Map(counts.map((c) => [c.category, c._count._all]));
    return { data: Object.entries(communityApi.CATEGORIES).map(([key, name]) => ({ key, name, models: by.get(key) ?? 0 })) };
  });

  route(app, ctx, communityApi.getModel, async ({ params }, req) => {
    const { asset } = await loadVisibleModel(ctx.db, viewer(req), modelIdOf(params.id));
    return detail(asset, viewer(req));
  });

  // ───────────── publishing ─────────────

  async function ownModel(req: FastifyRequest, apiId: string): Promise<Asset> {
    const userId = requireUser(req);
    const a = await ctx.db.asset.findUnique({ where: { id: modelIdOf(apiId) } });
    if (!a || a.deletedAt || a.ownerId !== userId) throw new AppError('NOT_FOUND', 'Model not found');
    return a;
  }

  /** Remixes keep the parent's terms: share-alike stays share-alike, non-commercial stays non-commercial. */
  async function assertRemixLicense(a: Asset, mine: { code: string; allowsCommercial: boolean }) {
    if (!a.forkedFromId) return;
    const parent = await ctx.db.asset.findUnique({ where: { id: a.forkedFromId } });
    const pl = parent ? await licenseOf(parent) : null;
    if (!parent || !pl) return;
    if (!pl.license.allowsDerivatives) throw new AppError('LICENSE_FORBIDS_DERIVATIVE', `${parent.title} is licensed ${pl.license.code}, which does not allow remixes`);
    if (pl.license.code.includes('-SA-') && mine.code !== pl.license.code) throw new AppError('LICENSE_INCOMPATIBLE', `A remix of a ${pl.license.code} model must use ${pl.license.code}`, { required: pl.license.code });
    if (!pl.license.allowsCommercial && mine.allowsCommercial) throw new AppError('LICENSE_INCOMPATIBLE', `${parent.title} is non-commercial, so its remix must be non-commercial too`);
  }

  route(app, ctx, communityApi.publishModel, async ({ params, body }, req) => {
    const a = await ownModel(req, params.id);
    const userId = a.ownerId;
    const me = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!me.handle) throw new AppError('CREATOR_HANDLE_REQUIRED', 'Choose a creator name before sharing');
    if (a.publishStatus === 'REMOVED') throw new AppError('INVALID_STATE', 'This model was taken down and cannot be shared again');
    const ml = await licenseOf(a);
    if (!ml) throw new AppError('LICENSE_MISSING', 'Choose a license before sharing');
    await assertRemixLicense(a, { code: ml.license.code, allowsCommercial: ml.license.allowsCommercial });
    const version = a.currentVersionId ? await ctx.db.assetVersion.findUnique({ where: { id: a.currentVersionId }, include: { files: true } }) : null;
    const mesh = version?.files.find((f) => (MESH_ROLES as readonly string[]).includes(f.role) && f.role !== 'GLB' && (!f.expiresAt || f.expiresAt > new Date()));
    if (!version || !mesh) throw new AppError('INVALID_STATE', 'This model has no printable file yet');
    const title = body.title ?? a.title;
    await moderate(req, [title, body.description, ...body.tags, body.print_notes?.notes ?? ''].join('\n'), 'community');
    const auto = ctx.env.COMMUNITY_REVIEW === 'auto';
    const now = ctx.now();
    const updated = await ctx.db.$transaction(async (tx) => {
      const u = await tx.asset.update({
        where: { id: a.id },
        data: {
          title,
          description: body.description,
          category: body.category,
          tags: [...new Set(body.tags)],
          ...(body.print_notes ? { printNotes: body.print_notes as Prisma.InputJsonValue } : {}),
          listed: body.listed,
          needsRepair: version.isWatertight === false,
          reviewNote: null,
          publishStatus: auto ? 'PUBLISHED' : 'REVIEW',
          visibility: auto ? (body.listed ? 'PUBLIC' : 'UNLISTED') : a.publishStatus === 'PUBLISHED' ? a.visibility : 'PRIVATE',
          publishedAt: auto ? (a.publishedAt ?? now) : a.publishedAt,
        },
      });
      await audit(tx, { actorId: userId, action: auto ? 'community.publish' : 'community.submit', targetType: 'asset', targetId: a.id, requestId: req.id });
      return u;
    });
    return detail(updated, userId);
  });

  route(app, ctx, communityApi.updateModelPage, async ({ params, body }, req) => {
    const a = await ownModel(req, params.id);
    if (a.publishStatus === 'NONE' || a.publishStatus === 'REMOVED') throw new AppError('INVALID_STATE', 'Share the model first');
    const text = [body.title ?? '', body.description ?? '', ...(body.tags ?? []), body.print_notes?.notes ?? ''].join('\n');
    if (text.trim()) await moderate(req, text, 'community');
    const updated = await ctx.db.asset.update({
      where: { id: a.id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.tags ? { tags: [...new Set(body.tags)] } : {}),
        ...(body.print_notes !== undefined ? { printNotes: body.print_notes === null ? Prisma.DbNull : (body.print_notes as Prisma.InputJsonValue) } : {}),
        ...(body.listed !== undefined ? { listed: body.listed, ...(a.publishStatus === 'PUBLISHED' ? { visibility: body.listed ? ('PUBLIC' as const) : ('UNLISTED' as const) } : {}) } : {}),
      },
    });
    return detail(updated, a.ownerId);
  });

  route(app, ctx, communityApi.unpublishModel, async ({ params }, req) => {
    const a = await ownModel(req, params.id);
    if (a.publishStatus === 'REMOVED') throw new AppError('INVALID_STATE', 'This model was taken down');
    await ctx.db.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: a.id }, data: { publishStatus: 'NONE', visibility: 'PRIVATE' } });
      await audit(tx, { actorId: a.ownerId, action: 'community.unpublish', targetType: 'asset', targetId: a.id, requestId: req.id });
    });
    return { ok: true as const };
  });

  route(app, ctx, communityApi.addPhoto, async ({ params, body }, req) => {
    const a = await ownModel(req, params.id);
    if (!a.currentVersionId) throw new AppError('INVALID_STATE', 'This model has no version yet');
    const up = await ctx.db.upload.findUnique({ where: { id: idOr404('upload', body.upload_id, 'Upload') } });
    if (!up || up.ownerId !== a.ownerId || up.purpose !== 'IMAGE') throw new AppError('NOT_FOUND', 'Upload not found');
    if (up.status !== 'CLEAN') throw new AppError('INVALID_STATE', 'Finish uploading the photo first');
    const count = await ctx.db.assetFile.count({ where: { role: 'PHOTO', assetVersion: { assetId: a.id } } });
    if (count >= MAX_PHOTOS) throw new AppError('UPLOAD_LIMIT_EXCEEDED', `A model can have up to ${MAX_PHOTOS} photos`);
    const body2 = await ctx.storage.get(up.storageKey);
    const id = newId();
    const ext = up.filename.split('.').pop()!.toLowerCase();
    const key = `assets/${a.id}/photos/${id}.${ext}`;
    await ctx.storage.put(key, body2, up.contentType);
    const f = await ctx.db.assetFile.create({ data: { id, ownerId: a.ownerId, assetVersionId: a.currentVersionId, role: 'PHOTO', storageKey: key, contentType: up.contentType, filename: up.filename, sha256: up.sha256 ?? sha256Hex(body2), bytes: body2.length } });
    return { id: toApiId('file', f.id), role: f.role, filename: f.filename, content_type: f.contentType, bytes: f.bytes };
  });

  route(app, ctx, communityApi.removePhoto, async ({ params }, req) => {
    const a = await ownModel(req, params.id);
    const f = await ctx.db.assetFile.findUnique({ where: { id: idOr404('file', params.file_id, 'Photo') }, include: { assetVersion: true } });
    if (!f || f.role !== 'PHOTO' || f.assetVersion?.assetId !== a.id) throw new AppError('NOT_FOUND', 'Photo not found');
    await ctx.db.assetFile.delete({ where: { id: f.id } });
    await ctx.storage.delete(f.storageKey).catch(() => undefined);
    return { ok: true as const };
  });

  // ───────────── downloads ─────────────

  route(app, ctx, communityApi.downloadModel, async ({ params, body }, req) => {
    const userId = requireUser(req);
    const { asset: a, isOwner } = await loadVisibleModel(ctx.db, userId, modelIdOf(params.id));
    const version = a.currentVersionId ? await ctx.db.assetVersion.findUnique({ where: { id: a.currentVersionId }, include: { files: true } }) : null;
    const usable = (version?.files ?? []).filter((f) => (MESH_ROLES as readonly string[]).includes(f.role) && (!f.expiresAt || f.expiresAt > new Date()));
    const file = body.file_id ? usable.find((f) => f.id === fromApiId('file', body.file_id!)) : [...usable].sort((x, y) => MESH_ROLES.indexOf(x.role as never) - MESH_ROLES.indexOf(y.role as never))[0];
    if (!file) throw new AppError('NOT_FOUND', 'File not found');
    const ml = await licenseOf(a);
    const owner = await ctx.db.user.findUniqueOrThrow({ where: { id: a.ownerId }, select: { handle: true, name: true } });
    const license = ml ? licenseBlock(ml.license, ml, { title: a.title, author: owner.handle ?? owner.name ?? 'a creator' }) : null;
    if (!license) throw new AppError('LICENSE_MISSING', 'This model has no license');
    const snapshot = { ...license, text: ml!.license.text, personal_print_only: ml!.license.personalPrintOnly, captured_at: ctx.now().toISOString() };
    await ctx.db.$transaction(async (tx) => {
      await tx.assetDownload.create({ data: { assetId: a.id, userId, fileId: file.id, licenseCode: license.code, licenseSnapshot: snapshot } });
      if (!isOwner) await tx.asset.update({ where: { id: a.id }, data: { downloadCount: { increment: 1 } } });
    });
    const ext = file.role === 'PREVIEW_MESH' ? 'stl' : file.filename.split('.').pop();
    const safeTitle = a.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'model';
    const filename = `${safeTitle}.${ext}`;
    const url = await ctx.storage.signedGetUrl(file.storageKey, { filename, contentType: file.contentType, ttlS: 300 });
    return { url, filename, license };
  });

  // ───────────── likes and saves (idempotent) ─────────────

  function toggle(kind: 'like' | 'save', on: boolean) {
    return async ({ params }: { params: { id: string } }, req: FastifyRequest) => {
      const userId = requireUser(req);
      const { asset: a } = await loadVisibleModel(ctx.db, userId, modelIdOf(params.id));
      const counter = kind === 'like' ? 'likeCount' : 'saveCount';
      const count = await ctx.db.$transaction(async (tx) => {
        const table = (kind === 'like' ? tx.assetLike : tx.assetSave) as unknown as {
          createMany(a: { data: { userId: string; assetId: string }[]; skipDuplicates: boolean }): Promise<{ count: number }>;
          deleteMany(a: { where: { userId: string; assetId: string } }): Promise<{ count: number }>;
        };
        const r = on ? await table.createMany({ data: [{ userId, assetId: a.id }], skipDuplicates: true }) : await table.deleteMany({ where: { userId, assetId: a.id } });
        if (r.count === 0) return a[counter];
        const u = await tx.asset.update({ where: { id: a.id }, data: { [counter]: { [on ? 'increment' : 'decrement']: r.count } } });
        return u[counter];
      });
      return { active: on, count };
    };
  }
  route(app, ctx, communityApi.likeModel, toggle('like', true));
  route(app, ctx, communityApi.unlikeModel, toggle('like', false));
  route(app, ctx, communityApi.saveModel, toggle('save', true));
  route(app, ctx, communityApi.unsaveModel, toggle('save', false));

  route(app, ctx, communityApi.listSaved, async ({ query }, req) => {
    const userId = requireUser(req);
    const offset = offsetOf(query.cursor);
    const saves = await ctx.db.assetSave.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: offset, take: query.limit + 1 });
    const assets = await ctx.db.asset.findMany({ where: { id: { in: saves.map((s) => s.assetId) } } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    const visible = saves
      .slice(0, query.limit)
      .map((s) => byId.get(s.assetId))
      .filter((a): a is Asset => Boolean(a && !a.deletedAt && (a.ownerId === userId || (a.publishStatus === 'PUBLISHED' && a.visibility !== 'PRIVATE'))));
    return { data: await cards(ctx.db, ctx.storage, visible), next_cursor: saves.length > query.limit ? String(offset + query.limit) : null };
  });

  // ───────────── comments ─────────────

  const commentOut = (c: { id: string; body: string; authorId: string; createdAt: Date }, author: { handle: string | null; name: string | null } | undefined, viewerId: string | null) => ({
    id: toApiId('comment', c.id),
    body: c.body,
    author: { handle: author?.handle ?? null, name: author?.name ?? null },
    is_mine: viewerId === c.authorId,
    created_at: c.createdAt.toISOString(),
  });

  route(app, ctx, communityApi.listComments, async ({ params, query }, req) => {
    const { asset: a } = await loadVisibleModel(ctx.db, viewer(req), modelIdOf(params.id));
    const offset = offsetOf(query.cursor);
    const rows = await ctx.db.assetComment.findMany({ where: { assetId: a.id, status: 'VISIBLE' }, orderBy: { createdAt: 'asc' }, skip: offset, take: query.limit + 1 });
    const authors = await ctx.db.user.findMany({ where: { id: { in: rows.map((r) => r.authorId) } }, select: { id: true, handle: true, name: true } });
    const by = new Map(authors.map((u) => [u.id, u]));
    return { data: rows.slice(0, query.limit).map((c) => commentOut(c, by.get(c.authorId), viewer(req))), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });

  route(app, ctx, communityApi.addComment, async ({ params, body }, req) => {
    const userId = requireUser(req);
    const { asset: a } = await loadVisibleModel(ctx.db, userId, modelIdOf(params.id));
    if (a.publishStatus !== 'PUBLISHED') throw new AppError('INVALID_STATE', 'Comments open once the model is shared');
    await moderate(req, body.body, 'comment');
    const c = await ctx.db.assetComment.create({ data: { assetId: a.id, authorId: userId, body: body.body } });
    const me = await ctx.db.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true, name: true } });
    return commentOut(c, me, userId);
  });

  route(app, ctx, communityApi.deleteComment, async ({ params }, req) => {
    const userId = requireUser(req);
    const c = await ctx.db.assetComment.findUnique({ where: { id: idOr404('comment', params.id, 'Comment') } });
    if (!c || c.authorId !== userId) throw new AppError('NOT_FOUND', 'Comment not found');
    await ctx.db.assetComment.delete({ where: { id: c.id } });
    return { ok: true as const };
  });

  // ───────────── remixes ─────────────

  route(app, ctx, communityApi.remixModel, async ({ params }, req) => {
    const userId = requireUser(req);
    const { asset: parent } = await loadVisibleModel(ctx.db, userId, modelIdOf(params.id));
    const pl = await licenseOf(parent);
    if (!pl || !pl.license.allowsDerivatives) throw new AppError('LICENSE_FORBIDS_DERIVATIVE', `${parent.title} is licensed ${pl?.license.code ?? 'without a license'}, which does not allow remixes`);
    const version = parent.currentVersionId ? await ctx.db.assetVersion.findUnique({ where: { id: parent.currentVersionId }, include: { files: true } }) : null;
    const files = (version?.files ?? []).filter((f) => (MESH_ROLES as readonly string[]).includes(f.role) && (!f.expiresAt || f.expiresAt > new Date()));
    if (!version || files.length === 0) throw new AppError('INVALID_STATE', 'This model has no files to remix');
    const assetId = newId();
    const versionId = newId();
    const copies = await Promise.all(
      files.map(async (f) => {
        const id = newId();
        const key = `assets/${assetId}/${versionId}/${id}.${f.storageKey.split('.').pop()}`;
        await ctx.storage.put(key, await ctx.storage.get(f.storageKey), f.contentType);
        return { id, ownerId: userId, assetVersionId: versionId, role: f.role === 'PREVIEW_MESH' ? ('STL' as const) : f.role, storageKey: key, contentType: f.contentType, filename: f.role === 'PREVIEW_MESH' ? 'model.stl' : f.filename, sha256: f.sha256, bytes: f.bytes };
      }),
    );
    const title = `Remix of ${parent.title}`.slice(0, 120);
    await ctx.db.$transaction(async (tx) => {
      await tx.asset.create({ data: { id: assetId, ownerId: userId, kind: 'UPLOAD', title, forkedFromId: parent.id, category: parent.category, tags: parent.tags } });
      await tx.assetVersion.create({ data: { id: versionId, assetId, number: 1, stage: 'UPLOAD', parentVersionId: version.id, triangles: version.triangles, bboxMm: version.bboxMm ?? Prisma.DbNull, isWatertight: version.isWatertight, analysis: version.analysis ?? Prisma.DbNull } });
      await tx.assetFile.createMany({ data: copies });
      await tx.asset.update({ where: { id: assetId }, data: { currentVersionId: versionId } });
      await audit(tx, { actorId: userId, action: 'community.remix', targetType: 'asset', targetId: assetId, data: { parent: parent.id, parent_license: pl.license.code }, requestId: req.id });
    });
    return { asset_id: toApiId('asset', assetId), title, required_license: pl.license.code.includes('-SA-') ? pl.license.code : null };
  });

  // ───────────── uploads into the library ─────────────

  route(app, ctx, communityApi.importUpload, async ({ body }, req) => {
    const userId = requireUser(req);
    const up = await ctx.db.upload.findUnique({ where: { id: idOr404('upload', body.upload_id, 'Upload') } });
    if (!up || up.ownerId !== userId || up.purpose !== 'PRINT') throw new AppError('NOT_FOUND', 'Upload not found');
    if (up.status !== 'CLEAN') throw new AppError('INVALID_STATE', 'Finish uploading the file first');
    const ext = up.filename.split('.').pop()!.toLowerCase() as keyof typeof UPLOAD_ROLE;
    if (!UPLOAD_ROLE[ext]) throw new AppError('UPLOAD_REJECTED', 'Only STL, OBJ, and 3MF files can be added');
    const data = await ctx.storage.get(up.storageKey);
    let analysis;
    try {
      analysis = await ctx.mesh.analyze(data, ext);
    } catch (e) {
      if (e instanceof MeshServiceError && e.status === 422) throw new AppError('UPLOAD_REJECTED', e.message);
      throw new AppError('MESH_SERVICE_ERROR', 'The file could not be checked right now; try again');
    }
    const assetId = newId();
    const versionId = newId();
    const fileId = newId();
    const key = `assets/${assetId}/${versionId}/${fileId}.${ext}`;
    await ctx.storage.put(key, data, UPLOAD_CT[ext]);
    const title = (body.title ?? up.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()).slice(0, 120) || 'Uploaded model';
    await moderate(req, title, 'library');
    await ctx.db.$transaction(async (tx) => {
      await tx.asset.create({ data: { id: assetId, ownerId: userId, kind: 'UPLOAD', title } });
      await tx.assetVersion.create({ data: { id: versionId, assetId, number: 1, stage: 'UPLOAD', triangles: analysis.triangles, bboxMm: analysis.bbox_mm, isWatertight: analysis.watertight, analysis: analysis as unknown as Prisma.InputJsonValue } });
      await tx.assetFile.create({ data: { id: fileId, ownerId: userId, assetVersionId: versionId, role: UPLOAD_ROLE[ext], storageKey: key, contentType: UPLOAD_CT[ext], filename: up.filename, sha256: up.sha256 ?? sha256Hex(data), bytes: data.length } });
      await tx.asset.update({ where: { id: assetId }, data: { currentVersionId: versionId } });
    });
    return { asset_id: toApiId('asset', assetId), title, watertight: analysis.watertight, triangles: analysis.triangles };
  });

  // ───────────── reports ─────────────

  route(app, ctx, communityApi.report, async ({ body }, req) => {
    const userId = requireUser(req);
    let targetId: string;
    if (body.target_type === 'MODEL') targetId = (await loadVisibleModel(ctx.db, userId, modelIdOf(body.target_id))).asset.id;
    else if (body.target_type === 'COMMENT') {
      const c = await ctx.db.assetComment.findUnique({ where: { id: idOr404('comment', body.target_id, 'Comment') } });
      if (!c || c.status !== 'VISIBLE') throw new AppError('NOT_FOUND', 'Comment not found');
      targetId = c.id;
    } else {
      const u = await ctx.db.user.findFirst({ where: { handle: { equals: body.target_id, mode: 'insensitive' } } });
      if (!u) throw new AppError('NOT_FOUND', 'Creator not found');
      targetId = u.id;
    }
    const r = await ctx.db.contentReport.upsert({
      where: { targetType_targetId_reporterId: { targetType: body.target_type, targetId, reporterId: userId } },
      update: {},
      create: { targetType: body.target_type, targetId, reporterId: userId, reason: body.reason, details: body.details },
    });
    return { id: toApiId('report', r.id), status: r.status };
  });

  // ───────────── collections ─────────────

  async function collectionOut(c: { id: string; ownerId: string; title: string; description: string; isPublic: boolean; createdAt: Date }, viewerId: string | null) {
    const [items, owner] = await Promise.all([ctx.db.collectionItem.count({ where: { collectionId: c.id } }), ctx.db.user.findUnique({ where: { id: c.ownerId }, select: { handle: true, name: true } })]);
    return { id: toApiId('collection', c.id), title: c.title, description: c.description, is_public: c.isPublic, items, owner: { handle: owner?.handle ?? null, name: owner?.name ?? null }, is_owner: viewerId === c.ownerId, created_at: c.createdAt.toISOString() };
  }
  async function ownCollection(req: FastifyRequest, apiId: string) {
    const userId = requireUser(req);
    const c = await ctx.db.collection.findUnique({ where: { id: idOr404('collection', apiId, 'Collection') } });
    if (!c || c.ownerId !== userId) throw new AppError('NOT_FOUND', 'Collection not found');
    return c;
  }

  route(app, ctx, communityApi.listCollections, async (_i, req) => {
    const userId = requireUser(req);
    const rows = await ctx.db.collection.findMany({ where: { ownerId: userId }, orderBy: { updatedAt: 'desc' } });
    return { data: await Promise.all(rows.map((c) => collectionOut(c, userId))) };
  });
  route(app, ctx, communityApi.createCollection, async ({ body }, req) => {
    const userId = requireUser(req);
    await moderate(req, `${body.title}\n${body.description}`, 'collection');
    const c = await ctx.db.collection.create({ data: { ownerId: userId, title: body.title, description: body.description, isPublic: body.is_public } });
    return collectionOut(c, userId);
  });
  route(app, ctx, communityApi.getCollection, async ({ params }, req) => {
    const c = await ctx.db.collection.findUnique({ where: { id: idOr404('collection', params.id, 'Collection') } });
    // Private collections are 404 to everyone else, even by direct id.
    if (!c || (!c.isPublic && c.ownerId !== viewer(req))) throw new AppError('NOT_FOUND', 'Collection not found');
    const items = await ctx.db.collectionItem.findMany({ where: { collectionId: c.id }, orderBy: { position: 'asc' } });
    const assets = await ctx.db.asset.findMany({ where: { id: { in: items.map((i) => i.assetId) } } });
    const by = new Map(assets.map((a) => [a.id, a]));
    const shown = items.map((i) => by.get(i.assetId)).filter((a): a is Asset => Boolean(a && !a.deletedAt && (a.ownerId === viewer(req) || (a.publishStatus === 'PUBLISHED' && a.visibility !== 'PRIVATE'))));
    return { ...(await collectionOut(c, viewer(req))), models: await cards(ctx.db, ctx.storage, shown) };
  });
  route(app, ctx, communityApi.updateCollection, async ({ params, body }, req) => {
    const c = await ownCollection(req, params.id);
    if (body.title || body.description) await moderate(req, `${body.title ?? ''}\n${body.description ?? ''}`, 'collection');
    const u = await ctx.db.collection.update({ where: { id: c.id }, data: { ...(body.title ? { title: body.title } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.is_public !== undefined ? { isPublic: body.is_public } : {}) } });
    return collectionOut(u, c.ownerId);
  });
  route(app, ctx, communityApi.deleteCollection, async ({ params }, req) => {
    const c = await ownCollection(req, params.id);
    await ctx.db.collection.delete({ where: { id: c.id } });
    return { ok: true as const };
  });
  route(app, ctx, communityApi.addToCollection, async ({ params, body }, req) => {
    const c = await ownCollection(req, params.id);
    const { asset: a } = await loadVisibleModel(ctx.db, c.ownerId, modelIdOf(body.model_id));
    await ctx.db.$transaction(async (tx) => {
      const last = await tx.collectionItem.aggregate({ where: { collectionId: c.id }, _max: { position: true } });
      await tx.collectionItem.createMany({ data: [{ collectionId: c.id, assetId: a.id, position: (last._max.position ?? -1) + 1 }], skipDuplicates: true });
      await tx.collection.update({ where: { id: c.id }, data: { updatedAt: ctx.now() } });
    });
    return collectionOut(c, c.ownerId);
  });
  route(app, ctx, communityApi.removeFromCollection, async ({ params }, req) => {
    const c = await ownCollection(req, params.id);
    await ctx.db.collectionItem.deleteMany({ where: { collectionId: c.id, assetId: modelIdOf(params.model_id) } });
    return collectionOut(c, c.ownerId);
  });
  route(app, ctx, communityApi.reorderCollection, async ({ params, body }, req) => {
    const c = await ownCollection(req, params.id);
    const ids = body.model_ids.map(modelIdOf);
    const current = await ctx.db.collectionItem.findMany({ where: { collectionId: c.id }, select: { assetId: true } });
    const have = new Set(current.map((i) => i.assetId));
    if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((id) => !have.has(id))) throw new AppError('VALIDATION_FAILED', 'List every model in the collection exactly once');
    await ctx.db.$transaction(ids.map((assetId, position) => ctx.db.collectionItem.update({ where: { collectionId_assetId: { collectionId: c.id, assetId } }, data: { position } })));
    return collectionOut(c, c.ownerId);
  });

  // ───────────── creators ─────────────

  async function creatorByHandle(handle: string) {
    const u = await ctx.db.user.findFirst({ where: { handle: { equals: handle, mode: 'insensitive' }, status: 'ACTIVE' } });
    if (!u) throw new AppError('NOT_FOUND', 'Creator not found');
    return u;
  }

  route(app, ctx, communityApi.getCreator, async ({ params }, req) => {
    const u = await creatorByHandle(params.handle);
    const v = viewer(req);
    const [followers, following, agg] = await Promise.all([
      ctx.db.follow.count({ where: { creatorId: u.id } }),
      v ? ctx.db.follow.findUnique({ where: { followerId_creatorId: { followerId: v, creatorId: u.id } } }) : null,
      ctx.db.asset.aggregate({ where: { ownerId: u.id, publishStatus: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null }, _count: { _all: true }, _sum: { downloadCount: true } }),
    ]);
    return { handle: u.handle!, name: u.name, bio: u.bio, followers, following: Boolean(following), is_me: v === u.id, models: agg._count._all, downloads: agg._sum.downloadCount ?? 0, joined_at: u.createdAt.toISOString() };
  });

  function follow(on: boolean) {
    return async ({ params }: { params: { handle: string } }, req: FastifyRequest) => {
      const userId = requireUser(req);
      const u = await creatorByHandle(params.handle);
      if (u.id === userId) throw new AppError('VALIDATION_FAILED', 'You cannot follow yourself');
      if (on) await ctx.db.follow.createMany({ data: [{ followerId: userId, creatorId: u.id }], skipDuplicates: true });
      else await ctx.db.follow.deleteMany({ where: { followerId: userId, creatorId: u.id } });
      return { active: on, count: await ctx.db.follow.count({ where: { creatorId: u.id } }) };
    };
  }
  route(app, ctx, communityApi.followCreator, follow(true));
  route(app, ctx, communityApi.unfollowCreator, follow(false));

  route(app, ctx, communityApi.setProfile, async ({ body }, req) => {
    const userId = requireUser(req);
    const me = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    const data: Prisma.UserUpdateInput = {};
    if (body.handle !== undefined && body.handle.toLowerCase() !== me.handle?.toLowerCase()) {
      if (me.handle) throw new AppError('INVALID_STATE', 'Your creator name is already set');
      if (RESERVED_HANDLES.has(body.handle.toLowerCase())) throw new AppError('HANDLE_TAKEN', 'That creator name is not available');
      await moderate(req, body.handle, 'profile');
      if (await ctx.db.user.findFirst({ where: { handle: { equals: body.handle, mode: 'insensitive' } } })) throw new AppError('HANDLE_TAKEN', 'That creator name is taken');
      data.handle = body.handle;
    }
    if (body.bio !== undefined) {
      if (body.bio) await moderate(req, body.bio, 'profile');
      data.bio = body.bio || null;
    }
    try {
      const u = Object.keys(data).length ? await ctx.db.user.update({ where: { id: userId }, data }) : me;
      return { handle: u.handle, bio: u.bio };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('HANDLE_TAKEN', 'That creator name is taken');
      throw e;
    }
  });

  route(app, ctx, communityApi.creatorStats, async ({ query }, req) => {
    const userId = requireUser(req);
    const since = new Date(ctx.now().getTime() - query.days * 86400_000);
    const models = await ctx.db.asset.findMany({ where: { ownerId: userId, deletedAt: null, publishStatus: { not: 'NONE' } }, orderBy: { downloadCount: 'desc' } });
    const ids = models.map((m) => m.id);
    const [period, followers, comments] = await Promise.all([
      ctx.db.assetDownload.groupBy({ by: ['assetId'], where: { assetId: { in: ids }, createdAt: { gte: since }, userId: { not: userId } }, _count: { _all: true } }),
      ctx.db.follow.count({ where: { creatorId: userId } }),
      ctx.db.assetComment.findMany({ where: { assetId: { in: ids }, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const inPeriod = new Map(period.map((p) => [p.assetId, p._count._all]));
    const authors = await ctx.db.user.findMany({ where: { id: { in: comments.map((c) => c.authorId) } }, select: { id: true, handle: true, name: true } });
    const by = new Map(authors.map((u) => [u.id, u]));
    const titles = new Map(models.map((m) => [m.id, m.title]));
    const sum = (k: 'downloadCount' | 'likeCount' | 'saveCount') => models.reduce((n, m) => n + m[k], 0);
    return {
      totals: { models: models.filter((m) => m.publishStatus === 'PUBLISHED').length, downloads: sum('downloadCount'), likes: sum('likeCount'), saves: sum('saveCount'), followers, downloads_in_period: [...inPeriod.values()].reduce((a, b) => a + b, 0) },
      models: models.map((m) => ({ id: modelApiId(m.id), title: m.title, publish_status: m.publishStatus, downloads: m.downloadCount, likes: m.likeCount, saves: m.saveCount, downloads_in_period: inPeriod.get(m.id) ?? 0 })),
      recent_comments: comments.map((c) => ({ ...commentOut(c, by.get(c.authorId), userId), model_id: modelApiId(c.assetId), model_title: titles.get(c.assetId) ?? '' })),
    };
  });

  // ───────────── admin: review and reports ─────────────

  route(app, ctx, communityApi.adminReviewQueue, async () => {
    const rows = await ctx.db.asset.findMany({ where: { publishStatus: 'REVIEW', deletedAt: null }, orderBy: { updatedAt: 'asc' }, take: 200, include: { owner: { select: { handle: true } } } });
    return { data: rows.map((a) => ({ id: modelApiId(a.id), title: a.title, creator: a.owner.handle, license_code: a.license, needs_repair: a.needsRepair, description: a.description, submitted_at: a.updatedAt.toISOString() })) };
  });

  async function takeDown(tx: Prisma.TransactionClient, assetId: string) {
    await tx.asset.update({ where: { id: assetId }, data: { publishStatus: 'REMOVED', visibility: 'PRIVATE' } });
  }

  route(app, ctx, communityApi.adminReviewDecision, async ({ params, body }, req) => {
    const a = await ctx.db.asset.findUnique({ where: { id: modelIdOf(params.id) } });
    if (!a || a.deletedAt) throw new AppError('NOT_FOUND', 'Model not found');
    if (body.decision !== 'remove' && a.publishStatus !== 'REVIEW') throw new AppError('INVALID_STATE', 'This model is not waiting for review');
    const status = await ctx.db.$transaction(async (tx) => {
      if (body.decision === 'approve') await tx.asset.update({ where: { id: a.id }, data: { publishStatus: 'PUBLISHED', visibility: a.listed ? 'PUBLIC' : 'UNLISTED', publishedAt: a.publishedAt ?? ctx.now(), reviewNote: null } });
      else if (body.decision === 'reject') await tx.asset.update({ where: { id: a.id }, data: { publishStatus: 'REJECTED', visibility: 'PRIVATE', reviewNote: body.note ?? 'Not approved' } });
      else await takeDown(tx, a.id);
      await audit(tx, { actorId: req.auth.userId, action: `community.review.${body.decision}`, targetType: 'asset', targetId: a.id, reason: body.note ?? null, requestId: req.id });
      return (await tx.asset.findUniqueOrThrow({ where: { id: a.id } })).publishStatus;
    });
    return { id: modelApiId(a.id), publish_status: status };
  });

  route(app, ctx, communityApi.adminListReports, async ({ query }) => {
    const rows = await ctx.db.contentReport.findMany({ where: { status: query.status }, orderBy: { createdAt: 'asc' }, take: 200 });
    const counts = await ctx.db.contentReport.groupBy({ by: ['targetType', 'targetId'], where: { targetId: { in: rows.map((r) => r.targetId) } }, _count: { _all: true } });
    const n = new Map(counts.map((c) => [`${c.targetType}:${c.targetId}`, c._count._all]));
    const target = (t: string, id: string) => (t === 'MODEL' ? modelApiId(id) : t === 'COMMENT' ? toApiId('comment', id) : toApiId('user', id));
    return { data: rows.map((r) => ({ id: toApiId('report', r.id), target_type: r.targetType, target_id: target(r.targetType, r.targetId), reason: r.reason, details: r.details, status: r.status, reports_on_target: n.get(`${r.targetType}:${r.targetId}`) ?? 1, created_at: r.createdAt.toISOString() })) };
  });

  route(app, ctx, communityApi.adminActOnReport, async ({ params, body }, req) => {
    const r = await ctx.db.contentReport.findUnique({ where: { id: idOr404('report', params.id, 'Report') } });
    if (!r) throw new AppError('NOT_FOUND', 'Report not found');
    const status = body.action === 'dismiss' ? 'DISMISSED' : 'ACTIONED';
    await ctx.db.$transaction(async (tx) => {
      if (body.action === 'take_down') {
        if (r.targetType === 'MODEL') await takeDown(tx, r.targetId);
        else if (r.targetType === 'COMMENT') await tx.assetComment.update({ where: { id: r.targetId }, data: { status: 'HIDDEN' } });
        else await tx.asset.updateMany({ where: { ownerId: r.targetId, publishStatus: { in: ['PUBLISHED', 'REVIEW'] } }, data: { publishStatus: 'REMOVED', visibility: 'PRIVATE' } });
      }
      // Every open report on the same item is settled together.
      await tx.contentReport.updateMany({ where: { targetType: r.targetType, targetId: r.targetId, status: 'OPEN' }, data: { status, handledBy: req.auth.userId, handledAt: ctx.now() } });
      await audit(tx, { actorId: req.auth.userId, action: `report.${body.action}`, targetType: r.targetType.toLowerCase(), targetId: r.targetId, reason: body.note ?? null, requestId: req.id });
    });
    return { id: toApiId('report', r.id), status };
  });
}
