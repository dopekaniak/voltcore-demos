import { z } from 'zod';
import { defineRoute, idParam, page } from './route';
import { jobSchema } from './jobs';
import { visibilityEnum } from './assets';

export const fileSchema = z.object({ id: z.string(), role: z.string(), filename: z.string(), content_type: z.string(), bytes: z.number().int(), expires_at: z.string().nullable() });
export const versionSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  stage: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  triangles: z.number().int().nullable(),
  bbox_mm: z.array(z.number()).nullable(),
  is_watertight: z.boolean().nullable(),
  analysis: z.record(z.string(), z.unknown()).nullable(),
  parent_version_id: z.string().nullable(),
  job_id: z.string().nullable(),
  files: z.array(fileSchema),
  created_at: z.string(),
});
export const assetSummary = z.object({
  id: z.string(),
  kind: z.enum(['GENERATED', 'FORGE', 'UPLOAD', 'PRINT_PART']),
  title: z.string(),
  prompt: z.string().nullable(),
  visibility: visibilityEnum,
  current_version: versionSchema.nullable(),
  thumbnail_file_id: z.string().nullable(),
  created_at: z.string(),
});

export const listAssets = defineRoute({
  method: 'GET',
  path: '/v1/assets',
  summary: 'Your library, newest first; filter by kind, search titles',
  tag: 'library',
  auth: 'user',
  scope: 'assets:read',
  query: z.object({ kind: z.enum(['GENERATED', 'FORGE', 'UPLOAD', 'PRINT_PART']).optional(), q: z.string().trim().max(100).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(24) }),
  response: page(assetSummary),
});

export const getAsset = defineRoute({ method: 'GET', path: '/v1/assets/:id', summary: 'An asset with all its versions and files', tag: 'library', auth: 'optional', params: idParam, response: assetSummary.extend({ versions: z.array(versionSchema), is_owner: z.boolean() }) });

export const repairVersion = defineRoute({
  method: 'POST',
  path: '/v1/assets/:id/versions/:version_id/repair',
  summary: 'Repair for printing: creates a new version, never overwrites the original',
  tag: 'library',
  auth: 'user',
  scope: 'assets:write',
  idempotent: true,
  status: 202,
  params: z.object({ id: z.string(), version_id: z.string() }),
  response: z.object({ job: jobSchema }),
});
