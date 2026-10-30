import { z } from 'zod';
import { defineRoute, idParam } from './route';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const forgeFeatureSchema = z.object({
  key: z.string(),
  part: z.string().nullable(),
  params: z.array(z.string()),
  derived: z.array(z.string()),
  bbox_mm: z.object({ min: vec3, max: vec3 }).nullable(),
  code_range: z.tuple([z.number().int(), z.number().int()]),
});

export const listForgeFeatures = defineRoute({
  method: 'GET',
  path: '/v1/forges/:id/features',
  summary: 'Named features of a forge version (empty when the forge has none)',
  tag: 'copilot',
  auth: 'optional',
  params: idParam,
  query: z.object({ version: z.string().optional() }),
  response: z.object({ featured: z.boolean(), data: z.array(forgeFeatureSchema) }),
});

export const selectionHitSchema = z.object({ feature: z.string().max(40).nullable().optional(), point: vec3 });

export const createRegionEdit = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/region-edits',
  summary: 'Resolve a selected area to one named feature (or candidates to pick from)',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  params: idParam,
  body: z
    .object({
      version_id: z.string().optional(),
      hits: z.array(selectionHitSchema).max(200).optional(),
      feature_key: z.string().max(40).optional(),
      message: z.string().max(500).optional(),
    })
    .refine((b) => (b.hits?.length ?? 0) > 0 || b.feature_key, { message: 'Select an area or name a feature' }),
  response: z.object({ target_feature_key: z.string(), feature: forgeFeatureSchema, share: z.number() }),
});
