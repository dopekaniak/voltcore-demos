import { AppError, fromApiId, toApiId } from '@sw/shared';
import type { Asset, AssetFile, Db } from '@sw/db';
import type { Storage } from '@sw/storage';

/** Images and viewer meshes are signed into list and page responses so a grid costs one request. */
export const EMBED_TTL_S = 15 * 60;

/**
 * Search ranking for the community catalog (ADR-045). A documented formula, our own, kept in
 * config so it can be reviewed for abuse (like farming). Text matches dominate; popularity only
 * breaks near-ties and grows with the log of counts, so a burst of likes cannot outrank a title
 * match.
 */
export const RANKING = {
  titleExact: 100,
  titlePrefix: 60,
  titleWord: 40,
  titleContains: 25,
  tag: 30,
  creator: 20,
  description: 10,
  /** popularity = weight × log10(1 + downloads + 2 × likes + saves) */
  popularityWeight: 5,
  /** At most this many text matches are scored per query (newest first). */
  candidateLimit: 1000,
} as const;

export function relevance(a: Pick<Asset, 'title' | 'description' | 'tags' | 'downloadCount' | 'likeCount' | 'saveCount'>, creatorHandle: string | null, q: string): number {
  const query = q.trim().toLowerCase();
  const title = a.title.toLowerCase();
  let s = 0;
  if (title === query) s += RANKING.titleExact;
  else if (title.startsWith(query)) s += RANKING.titlePrefix;
  else if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(title)) s += RANKING.titleWord;
  else if (title.includes(query)) s += RANKING.titleContains;
  if (a.tags.some((t) => t === query || t.includes(query))) s += RANKING.tag;
  if (creatorHandle && creatorHandle.toLowerCase() === query) s += RANKING.creator;
  if (a.description.toLowerCase().includes(query)) s += RANKING.description;
  return s + RANKING.popularityWeight * Math.log10(1 + a.downloadCount + 2 * a.likeCount + a.saveCount);
}

/** Model ids are asset ids; accept the asset, forge, and model prefixes. */
export function modelIdOf(apiId: string): string {
  const kind = apiId.startsWith('frg_') ? 'forge' : apiId.startsWith('mdl_') ? 'model' : 'asset';
  const id = fromApiId(kind, apiId);
  if (!id) throw new AppError('NOT_FOUND', 'Model not found');
  return id;
}
export const modelApiId = (id: string) => toApiId('asset', id);

/** Downloadable model files, best first. A forge's preview mesh is a full-resolution STL. */
export const MESH_ROLES = ['STL', 'THREEMF', 'OBJ', 'PREVIEW_MESH', 'GLB'] as const;
export const FILE_TYPE_ROLE = { stl: 'STL', '3mf': 'THREEMF', obj: 'OBJ', glb: 'GLB' } as const;
const ROLE_TYPE: Record<string, string> = { STL: 'stl', THREEMF: '3mf', OBJ: 'obj', GLB: 'glb', PREVIEW_MESH: 'stl' };

/** Is the model readable by this viewer as a community model? Others see only published ones. */
export function isPublicModel(a: Asset): boolean {
  return !a.deletedAt && a.publishStatus === 'PUBLISHED' && (a.visibility === 'PUBLIC' || a.visibility === 'UNLISTED');
}

export async function loadVisibleModel(db: Db, viewerId: string | null, id: string): Promise<{ asset: Asset; isOwner: boolean }> {
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset || asset.deletedAt) throw new AppError('NOT_FOUND', 'Model not found');
  const isOwner = viewerId !== null && asset.ownerId === viewerId;
  if (!isOwner && !isPublicModel(asset)) throw new AppError('NOT_FOUND', 'Model not found');
  return { asset, isOwner };
}

export type CardFiles = { current: AssetFile[]; photos: AssetFile[] };

/** Files for cards: the current version's files and every photo of the model, in one query. */
export async function filesFor(db: Db, assets: Asset[]): Promise<Map<string, CardFiles>> {
  const ids = assets.map((a) => a.id);
  const current = new Set(assets.map((a) => a.currentVersionId).filter((x): x is string => Boolean(x)));
  const rows = await db.assetFile.findMany({
    where: { assetVersion: { assetId: { in: ids } }, OR: [{ assetVersionId: { in: [...current] } }, { role: 'PHOTO' }] },
    include: { assetVersion: { select: { assetId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const out = new Map<string, CardFiles>(ids.map((id) => [id, { current: [], photos: [] }]));
  for (const f of rows) {
    const e = out.get(f.assetVersion!.assetId)!;
    if (f.role === 'PHOTO') e.photos.push(f);
    else if (f.assetVersionId && current.has(f.assetVersionId) && (!f.expiresAt || f.expiresAt > new Date())) e.current.push(f);
  }
  return out;
}

export async function creatorsFor(db: Db, ownerIds: string[]): Promise<Map<string, { handle: string | null; name: string | null }>> {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ownerIds)] } }, select: { id: true, handle: true, name: true } });
  return new Map(users.map((u) => [u.id, { handle: u.handle, name: u.name }]));
}

export function card(a: Asset, files: CardFiles | undefined, creator: { handle: string | null; name: string | null } | undefined, imageUrl: string | null) {
  const photo = files?.photos[0];
  const thumb = files?.current.find((f) => f.role === 'THUMBNAIL');
  return {
    image_url: imageUrl,
    id: modelApiId(a.id),
    title: a.title,
    category: a.category,
    tags: a.tags,
    creator: { handle: creator?.handle ?? 'unknown', name: creator?.name ?? null },
    license_code: a.license,
    photo_file_id: photo ? toApiId('file', photo.id) : null,
    thumbnail_file_id: thumb ? toApiId('file', thumb.id) : null,
    printable: !a.needsRepair,
    needs_repair: a.needsRepair,
    file_types: [...new Set((files?.current ?? []).map((f) => ROLE_TYPE[f.role]).filter((x): x is string => Boolean(x)))],
    downloads: a.downloadCount,
    likes: a.likeCount,
    saves: a.saveCount,
    published_at: a.publishedAt ? a.publishedAt.toISOString() : null,
  };
}

export const signed = (storage: Storage, f: AssetFile) => storage.signedGetUrl(f.storageKey, { contentType: f.contentType, ttlS: EMBED_TTL_S });

export async function cards(db: Db, storage: Storage, assets: Asset[]) {
  const [files, creators] = await Promise.all([filesFor(db, assets), creatorsFor(db, assets.map((a) => a.ownerId))]);
  return Promise.all(
    assets.map(async (a) => {
      const f = files.get(a.id);
      const img = f?.photos[0] ?? f?.current.find((x) => x.role === 'THUMBNAIL');
      return card(a, f, creators.get(a.ownerId), img ? await signed(storage, img) : null);
    }),
  );
}

/** Handles nobody can take: they would read as the platform speaking. */
export const RESERVED_HANDLES = new Set(['admin', 'administrator', 'api', 'support', 'help', 'staff', 'moderator', 'mod', 'official', 'system', 'root', 'shapewright', 'printforge', 'models', 'creators', 'collections', 'settings', 'me', 'null', 'undefined']);
