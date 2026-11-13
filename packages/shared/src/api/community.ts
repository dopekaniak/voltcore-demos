import { z } from 'zod';
import { defineRoute, idParam, okResponse, page } from './route';
import { licenseBlock } from './catalog';

/**
 * Community model library (Module 8). Built on library assets: anything a creator generated,
 * forged, or uploaded can be shared once it has a license. Search covers our own catalog only;
 * nothing here reads or indexes another site (ADR-045).
 */

/** Our own category names (Module 8 rule 2). Config, not copied from any site. */
export const CATEGORIES = {
  household: 'Home and kitchen',
  organizers: 'Storage and organizers',
  tools: 'Tools and workshop',
  'mechanical-parts': 'Mechanical parts',
  electronics: 'Electronics and cases',
  gadgets: 'Gadgets and phone',
  toys: 'Toys and games',
  miniatures: 'Miniatures and figures',
  art: 'Art and decor',
  fashion: 'Wearables',
  education: 'Learning',
  printer: 'Printer upgrades',
  other: 'Everything else',
} as const;
export const categoryEnum = z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES, ...(keyof typeof CATEGORIES)[]]);

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/i;
export const handleSchema = z.string().trim().regex(HANDLE_RE, 'Use 3-30 letters, numbers, hyphens or underscores');
const tagSchema = z.string().trim().toLowerCase().min(2).max(30).regex(/^[a-z0-9][a-z0-9 -]*$/, 'Tags use letters, numbers, spaces and hyphens');

export const printNotesSchema = z.object({
  material: z.string().trim().max(60).optional(),
  layer_height_mm: z.number().min(0.04).max(1.2).optional(),
  supports: z.enum(['none', 'some', 'required']).optional(),
  infill_pct: z.number().int().min(0).max(100).optional(),
  orientation: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const creatorBlock = z.object({ handle: z.string(), name: z.string().nullable(), followers: z.number().int(), models: z.number().int() });
export const publicFile = z.object({ id: z.string(), role: z.string(), filename: z.string(), content_type: z.string(), bytes: z.number().int() });
export const modelCard = z.object({
  id: z.string(),
  /** Signed photo or render URL, valid for 15 minutes. */
  image_url: z.string().nullable(),
  title: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  creator: z.object({ handle: z.string(), name: z.string().nullable() }),
  license_code: z.string(),
  photo_file_id: z.string().nullable(),
  thumbnail_file_id: z.string().nullable(),
  printable: z.boolean(),
  needs_repair: z.boolean(),
  file_types: z.array(z.string()),
  downloads: z.number().int(),
  likes: z.number().int(),
  saves: z.number().int(),
  published_at: z.string().nullable(),
});
export const lineageItem = z.object({ id: z.string(), title: z.string(), creator: z.string(), license_code: z.string() });
export const modelDetail = modelCard.extend({
  description: z.string(),
  print_notes: printNotesSchema.nullable(),
  publish_status: z.enum(['NONE', 'REVIEW', 'PUBLISHED', 'REJECTED', 'REMOVED']),
  listed: z.boolean(),
  review_note: z.string().nullable(),
  license: licenseBlock,
  creator: creatorBlock,
  files: z.array(publicFile),
  photos: z.array(publicFile.extend({ url: z.string() })),
  /** The mesh to show in the 3D viewer, signed for 15 minutes. */
  view: z.object({ url: z.string(), format: z.enum(['glb', 'stl']) }).nullable(),
  bbox_mm: z.array(z.number()).nullable(),
  triangles: z.number().int().nullable(),
  remix_of: lineageItem.nullable(),
  remixes: z.array(lineageItem),
  is_owner: z.boolean(),
  liked: z.boolean(),
  saved: z.boolean(),
  following: z.boolean(),
});

export const SORTS = ['relevance', 'newest', 'downloads', 'likes'] as const;
export const searchModels = defineRoute({
  method: 'GET',
  path: '/v1/community/models',
  summary: 'Search and browse shared models (our catalog only)',
  tag: 'community',
  auth: 'optional',
  query: z.object({
    q: z.string().trim().max(100).optional(),
    category: categoryEnum.optional(),
    tag: tagSchema.optional(),
    license: z.string().max(40).optional(),
    file_type: z.enum(['stl', 'obj', '3mf', 'glb']).optional(),
    printable: z.enum(['true', 'false']).optional(),
    remixable: z.enum(['true', 'false']).optional(),
    creator: handleSchema.optional(),
    sort: z.enum(SORTS).default('relevance'),
    cursor: z.string().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  }),
  response: page(modelCard).extend({ suggested_tags: z.array(z.string()) }),
});

export const listCategories = defineRoute({ method: 'GET', path: '/v1/community/categories', summary: 'Categories with model counts', tag: 'community', auth: 'none', response: z.object({ data: z.array(z.object({ key: z.string(), name: z.string(), models: z.number().int() })) }) });

export const getModel = defineRoute({ method: 'GET', path: '/v1/community/models/:id', summary: 'A shared model page', tag: 'community', auth: 'optional', params: idParam, response: modelDetail });

export const publishModel = defineRoute({
  method: 'POST',
  path: '/v1/community/models/:id/publish',
  summary: 'Share a library model with the community (goes to review unless review is off)',
  tag: 'community',
  auth: 'user',
  scope: 'assets:write',
  params: idParam,
  body: z.object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(10000),
    category: categoryEnum,
    tags: z.array(tagSchema).max(12).default([]),
    print_notes: printNotesSchema.optional(),
    listed: z.boolean().default(true),
  }),
  response: modelDetail,
});

export const updateModelPage = defineRoute({
  method: 'PATCH',
  path: '/v1/community/models/:id',
  summary: 'Edit the page of a shared model (text, tags, notes, listing)',
  tag: 'community',
  auth: 'user',
  scope: 'assets:write',
  params: idParam,
  body: z.object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(10000).optional(),
    category: categoryEnum.optional(),
    tags: z.array(tagSchema).max(12).optional(),
    print_notes: printNotesSchema.nullable().optional(),
    listed: z.boolean().optional(),
  }),
  response: modelDetail,
});

export const unpublishModel = defineRoute({ method: 'POST', path: '/v1/community/models/:id/unpublish', summary: 'Stop sharing a model (it stays in your library)', tag: 'community', auth: 'user', scope: 'assets:write', params: idParam, response: okResponse });

export const addPhoto = defineRoute({
  method: 'POST',
  path: '/v1/community/models/:id/photos',
  summary: 'Add a photo of a print (from a finished image upload)',
  tag: 'community',
  auth: 'user',
  scope: 'assets:write',
  params: idParam,
  body: z.object({ upload_id: z.string() }),
  response: publicFile,
});
export const removePhoto = defineRoute({ method: 'DELETE', path: '/v1/community/models/:id/photos/:file_id', summary: 'Remove a photo', tag: 'community', auth: 'user', scope: 'assets:write', params: z.object({ id: z.string(), file_id: z.string() }), response: okResponse });

export const downloadModel = defineRoute({
  method: 'POST',
  path: '/v1/community/models/:id/download',
  summary: 'Download a file of a shared model; records the download with the license at that moment',
  tag: 'community',
  auth: 'user',
  scope: 'assets:read',
  params: idParam,
  body: z.object({ file_id: z.string().optional() }),
  response: z.object({ url: z.string(), filename: z.string(), license: licenseBlock }),
});

export const toggleResponse = z.object({ active: z.boolean(), count: z.number().int() });
export const likeModel = defineRoute({ method: 'PUT', path: '/v1/community/models/:id/like', summary: 'Like (idempotent)', tag: 'community', auth: 'user', params: idParam, response: toggleResponse });
export const unlikeModel = defineRoute({ method: 'DELETE', path: '/v1/community/models/:id/like', summary: 'Remove a like', tag: 'community', auth: 'user', params: idParam, response: toggleResponse });
export const saveModel = defineRoute({ method: 'PUT', path: '/v1/community/models/:id/save', summary: 'Save for later (private)', tag: 'community', auth: 'user', params: idParam, response: toggleResponse });
export const unsaveModel = defineRoute({ method: 'DELETE', path: '/v1/community/models/:id/save', summary: 'Remove from saved', tag: 'community', auth: 'user', params: idParam, response: toggleResponse });
export const listSaved = defineRoute({ method: 'GET', path: '/v1/community/saved', summary: 'Models you saved, newest first', tag: 'community', auth: 'user', query: z.object({ cursor: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(48).default(24) }), response: page(modelCard) });

export const commentSchema = z.object({ id: z.string(), body: z.string(), author: z.object({ handle: z.string().nullable(), name: z.string().nullable() }), is_mine: z.boolean(), created_at: z.string() });
export const listComments = defineRoute({ method: 'GET', path: '/v1/community/models/:id/comments', summary: 'Comments, oldest first', tag: 'community', auth: 'optional', params: idParam, query: z.object({ cursor: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), response: page(commentSchema) });
export const addComment = defineRoute({ method: 'POST', path: '/v1/community/models/:id/comments', summary: 'Comment on a shared model', tag: 'community', auth: 'user', params: idParam, body: z.object({ body: z.string().trim().min(1).max(2000) }), status: 201, response: commentSchema });
export const deleteComment = defineRoute({ method: 'DELETE', path: '/v1/community/comments/:id', summary: 'Delete your comment', tag: 'community', auth: 'user', params: idParam, response: okResponse });

export const remixModel = defineRoute({
  method: 'POST',
  path: '/v1/community/models/:id/remix',
  summary: 'Start a remix: copies the files into a new private library model linked to its parent',
  tag: 'community',
  auth: 'user',
  scope: 'assets:write',
  idempotent: true,
  params: idParam,
  response: z.object({ asset_id: z.string(), title: z.string(), required_license: z.string().nullable() }),
});

export const report = defineRoute({
  method: 'POST',
  path: '/v1/reports',
  summary: 'Report a model, comment, or creator (one open report per item per person)',
  tag: 'community',
  auth: 'user',
  body: z.object({ target_type: z.enum(['MODEL', 'COMMENT', 'CREATOR']), target_id: z.string().max(64), reason: z.enum(['prohibited', 'copyright', 'trademark', 'harassment', 'spam', 'broken', 'other']), details: z.string().trim().max(2000).default('') }),
  status: 201,
  response: z.object({ id: z.string(), status: z.string() }),
});

export const collectionSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), is_public: z.boolean(), items: z.number().int(), owner: z.object({ handle: z.string().nullable(), name: z.string().nullable() }), is_owner: z.boolean(), created_at: z.string() });
export const listCollections = defineRoute({ method: 'GET', path: '/v1/collections', summary: 'Your collections', tag: 'community', auth: 'user', response: z.object({ data: z.array(collectionSchema) }) });
export const createCollection = defineRoute({ method: 'POST', path: '/v1/collections', summary: 'Create a collection (private by default)', tag: 'community', auth: 'user', body: z.object({ title: z.string().trim().min(1).max(80), description: z.string().trim().max(1000).default(''), is_public: z.boolean().default(false) }), status: 201, response: collectionSchema });
export const getCollection = defineRoute({ method: 'GET', path: '/v1/collections/:id', summary: 'A collection and its models in order (private ones only to the owner)', tag: 'community', auth: 'optional', params: idParam, response: collectionSchema.extend({ models: z.array(modelCard) }) });
export const updateCollection = defineRoute({ method: 'PATCH', path: '/v1/collections/:id', summary: 'Rename or change who can see a collection', tag: 'community', auth: 'user', params: idParam, body: z.object({ title: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(1000).optional(), is_public: z.boolean().optional() }), response: collectionSchema });
export const deleteCollection = defineRoute({ method: 'DELETE', path: '/v1/collections/:id', summary: 'Delete a collection', tag: 'community', auth: 'user', params: idParam, response: okResponse });
export const addToCollection = defineRoute({ method: 'POST', path: '/v1/collections/:id/items', summary: 'Add a shared model (idempotent)', tag: 'community', auth: 'user', params: idParam, body: z.object({ model_id: z.string() }), response: collectionSchema });
export const removeFromCollection = defineRoute({ method: 'DELETE', path: '/v1/collections/:id/items/:model_id', summary: 'Remove a model', tag: 'community', auth: 'user', params: z.object({ id: z.string(), model_id: z.string() }), response: collectionSchema });
export const reorderCollection = defineRoute({ method: 'PUT', path: '/v1/collections/:id/order', summary: 'Set the order (every model in the collection, once)', tag: 'community', auth: 'user', params: idParam, body: z.object({ model_ids: z.array(z.string()).max(1000) }), response: collectionSchema });

export const creatorProfile = z.object({ handle: z.string(), name: z.string().nullable(), bio: z.string().nullable(), followers: z.number().int(), following: z.boolean(), is_me: z.boolean(), models: z.number().int(), downloads: z.number().int(), joined_at: z.string() });
export const getCreator = defineRoute({ method: 'GET', path: '/v1/creators/:handle', summary: 'A creator profile', tag: 'community', auth: 'optional', params: z.object({ handle: z.string().max(40) }), response: creatorProfile });
export const followCreator = defineRoute({ method: 'PUT', path: '/v1/creators/:handle/follow', summary: 'Follow (idempotent)', tag: 'community', auth: 'user', params: z.object({ handle: z.string().max(40) }), response: toggleResponse });
export const unfollowCreator = defineRoute({ method: 'DELETE', path: '/v1/creators/:handle/follow', summary: 'Unfollow', tag: 'community', auth: 'user', params: z.object({ handle: z.string().max(40) }), response: toggleResponse });
export const setProfile = defineRoute({
  method: 'PUT',
  path: '/v1/me/profile',
  summary: 'Set your creator name (once) and bio',
  tag: 'community',
  auth: 'session',
  body: z.object({ handle: handleSchema.optional(), bio: z.string().trim().max(500).nullable().optional() }),
  response: z.object({ handle: z.string().nullable(), bio: z.string().nullable() }),
});

export const creatorStats = defineRoute({
  method: 'GET',
  path: '/v1/creator/stats',
  summary: 'Your shared models: downloads, likes, saves, followers, recent comments',
  tag: 'community',
  auth: 'user',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  response: z.object({
    totals: z.object({ models: z.number().int(), downloads: z.number().int(), likes: z.number().int(), saves: z.number().int(), followers: z.number().int(), downloads_in_period: z.number().int() }),
    models: z.array(z.object({ id: z.string(), title: z.string(), publish_status: z.string(), downloads: z.number().int(), likes: z.number().int(), saves: z.number().int(), downloads_in_period: z.number().int() })),
    recent_comments: z.array(commentSchema.extend({ model_id: z.string(), model_title: z.string() })),
  }),
});

export const reviewItem = z.object({ id: z.string(), title: z.string(), creator: z.string().nullable(), license_code: z.string(), needs_repair: z.boolean(), description: z.string(), submitted_at: z.string() });
export const adminReviewQueue = defineRoute({ method: 'GET', path: '/admin/community/review', summary: 'Models waiting for review, oldest first', tag: 'admin', auth: 'admin', response: z.object({ data: z.array(reviewItem) }) });
export const adminReviewDecision = defineRoute({
  method: 'POST',
  path: '/admin/community/models/:id/decision',
  summary: 'Approve, reject, or remove a shared model',
  tag: 'admin',
  auth: 'admin',
  params: idParam,
  body: z.object({ decision: z.enum(['approve', 'reject', 'remove']), note: z.string().trim().max(1000).optional() }),
  response: z.object({ id: z.string(), publish_status: z.string() }),
});
export const reportSchema = z.object({ id: z.string(), target_type: z.string(), target_id: z.string(), reason: z.string(), details: z.string(), status: z.string(), reports_on_target: z.number().int(), created_at: z.string() });
export const adminListReports = defineRoute({ method: 'GET', path: '/admin/reports', summary: 'Reports', tag: 'admin', auth: 'admin', query: z.object({ status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).default('OPEN') }), response: z.object({ data: z.array(reportSchema) }) });
export const adminActOnReport = defineRoute({
  method: 'POST',
  path: '/admin/reports/:id/action',
  summary: 'Dismiss a report, or take the reported item down',
  tag: 'admin',
  auth: 'admin',
  params: idParam,
  body: z.object({ action: z.enum(['dismiss', 'take_down']), note: z.string().trim().max(1000).optional() }),
  response: z.object({ id: z.string(), status: z.string() }),
});

export const importUpload = defineRoute({
  method: 'POST',
  path: '/v1/assets/from-upload',
  summary: 'Add an uploaded STL, OBJ, or 3MF to your library (so it can be shared or printed)',
  tag: 'library',
  auth: 'user',
  scope: 'assets:write',
  idempotent: true,
  body: z.object({ upload_id: z.string(), title: z.string().trim().min(1).max(120).optional() }),
  status: 201,
  response: z.object({ asset_id: z.string(), title: z.string(), watertight: z.boolean().nullable(), triangles: z.number().int().nullable() }),
});
