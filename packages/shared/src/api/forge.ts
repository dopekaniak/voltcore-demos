import { z } from 'zod';
import { defineRoute, idParam } from './route';
import { jobSchema } from './jobs';

export const paramSpecSchema = z.record(z.string(), z.object({ type: z.enum(['number', 'boolean', 'enum', 'text']), label: z.string() }).passthrough());
export const forgeCheckSchema = z.object({
  id: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  title: z.string(),
  message: z.string(),
  subpart: z.string().optional(),
});
export const paramValuesSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

export const forgeVersionSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  params: paramValuesSchema,
  bbox_mm: z.array(z.number()).nullable(),
  triangles: z.number().int().nullable(),
  checks: z.array(forgeCheckSchema),
  checks_failing: z.boolean(),
  profile: z.string(),
  author: z.string(),
  template_key: z.string().nullable(),
  created_at: z.string(),
});

export const forgeSchema = z.object({
  id: z.string(),
  asset_id: z.string(),
  title: z.string(),
  prompt: z.string().nullable(),
  visibility: z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']),
  is_owner: z.boolean(),
  forked_from: z.string().nullable(),
  version: forgeVersionSchema,
  source: z.object({ code: z.string(), schema: paramSpecSchema }),
  files: z.object({ preview_mesh: z.string().nullable(), thumbnail: z.string().nullable() }),
  created_at: z.string(),
});

export const starterSchema = z.object({ key: z.string(), title: z.string(), summary: z.string(), example_prompt: z.string() });

export const listStarters = defineRoute({ method: 'GET', path: '/v1/forges/starters', summary: 'Bundled starter forges', tag: 'forge', auth: 'none', response: z.object({ data: z.array(starterSchema) }) });
export const getStarter = defineRoute({
  method: 'GET',
  path: '/v1/forges/starters/:key',
  summary: 'A starter forge with its model code (for in-browser preview)',
  tag: 'forge',
  auth: 'none',
  params: z.object({ key: z.string().max(50) }),
  response: starterSchema.extend({ code: z.string() }),
});

export const createForge = defineRoute({
  method: 'POST',
  path: '/v1/forges',
  summary: 'Describe a part (or pick a starter); returns the FORGE_BUILD job',
  tag: 'forge',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  body: z
    .object({
      prompt: z.string().trim().min(3).max(600).optional(),
      starter_key: z.string().max(50).optional(),
      profile: z.enum(['fdm-0.4mm-nozzle']).optional(),
    })
    .refine((b) => Boolean(b.prompt) !== Boolean(b.starter_key), 'send exactly one of prompt or starter_key'),
  response: z.object({ job: jobSchema }),
});

export const getForge = defineRoute({ method: 'GET', path: '/v1/forges/:id', summary: 'Get a forge (latest version)', tag: 'forge', auth: 'optional', params: idParam, response: forgeSchema });
export const listForgeVersions = defineRoute({
  method: 'GET',
  path: '/v1/forges/:id/versions',
  summary: 'All versions of a forge, newest first',
  tag: 'forge',
  auth: 'optional',
  params: idParam,
  response: z.object({ data: z.array(forgeVersionSchema) }),
});

export const clampSchema = z.object({ key: z.string(), requested: z.unknown(), applied: z.union([z.number(), z.string(), z.boolean()]), reason: z.string(), message: z.string() });
export const patchForgeParams = defineRoute({
  method: 'PATCH',
  path: '/v1/forges/:id/params',
  summary: 'Validate parameters against the schema (clamping out-of-range values) and build a mesh at them',
  tag: 'forge',
  auth: 'user',
  scope: 'forge:write',
  params: idParam,
  body: z.object({ params: z.record(z.string(), z.unknown()), version_id: z.string().optional() }),
  status: 202,
  response: z.object({ params: paramValuesSchema, clamped: z.array(clampSchema), unknown: z.array(z.string()), job: jobSchema }),
});

export const createForgeExport = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/exports',
  summary: 'Export STL, 3MF, or STEP on the server (files expire after 7 days)',
  tag: 'forge',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  body: z.object({ format: z.enum(['stl', '3mf', 'step']), params: z.record(z.string(), z.unknown()).default({}), version_id: z.string().optional() }),
  response: z.object({ job: jobSchema, clamped: z.array(clampSchema) }),
});
