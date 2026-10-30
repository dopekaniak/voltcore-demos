import { z } from 'zod';
import { defineRoute, idParam } from './route';
import { jobSchema } from './jobs';
import { forgeCheckSchema } from './forge';

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
  response: z.object({ featured: z.boolean(), edit_cost: z.number().int(), data: z.array(forgeFeatureSchema) }),
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
  response: z.object({ target_feature_key: z.string(), feature: forgeFeatureSchema, share: z.number(), edit: z.lazy(() => copilotEditSchema).nullable(), job: jobSchema.nullable() }),
});

export const copilotEditSchema = z.object({
  id: z.string(),
  forge_id: z.string(),
  version_id: z.string(),
  message: z.string(),
  target_feature_key: z.string().nullable(),
  status: z.enum(['PROPOSING', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED']),
  credits: z.number().int(),
  notes: z.array(z.string()),
  diff: z
    .object({
      params: z.array(z.object({ key: z.string(), label: z.string(), from: z.unknown(), to: z.unknown() })),
      features: z.array(z.object({ key: z.string(), change: z.enum(['changed', 'added', 'removed']), lines: z.array(z.object({ op: z.enum(['-', '+']), text: z.string() })) })),
      bbox: z.object({ from: z.array(z.number()).nullable(), to: z.array(z.number()) }),
      code_changed: z.boolean(),
    })
    .nullable(),
  preview: z.object({ bbox_mm: z.array(z.number()), checks: z.array(forgeCheckSchema), checks_failing: z.boolean() }).nullable(),
  error: z.string().nullable(),
  result_version_id: z.string().nullable(),
  created_at: z.string(),
});

const editBody = z.object({ message: z.string().trim().min(3).max(500), target_feature_key: z.string().max(40).optional(), version_id: z.string().optional() });

export const createCopilotEdit = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/copilot-edits',
  summary: 'Ask the copilot to change the model; returns a proposal to accept or reject (credits are held until then)',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  body: editBody,
  response: z.object({ edit: copilotEditSchema, job: jobSchema }),
});

export const getCopilotEdit = defineRoute({ method: 'GET', path: '/v1/copilot-edits/:id', summary: 'A copilot edit and its proposed diff', tag: 'copilot', auth: 'user', params: idParam, response: copilotEditSchema });

export const listCopilotEdits = defineRoute({
  method: 'GET',
  path: '/v1/forges/:id/copilot-edits',
  summary: 'Copilot edits on a forge, newest first',
  tag: 'copilot',
  auth: 'user',
  params: idParam,
  response: z.object({ data: z.array(copilotEditSchema) }),
});

export const acceptCopilotEdit = defineRoute({
  method: 'POST',
  path: '/v1/copilot-edits/:id/accept',
  summary: 'Accept a proposal: charges its credits and saves it as a new version',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  response: z.object({ edit: copilotEditSchema, job: jobSchema }),
});

export const rejectCopilotEdit = defineRoute({
  method: 'POST',
  path: '/v1/copilot-edits/:id/reject',
  summary: 'Reject a proposal: its credits are released and the forge is unchanged',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  params: idParam,
  response: z.object({ edit: copilotEditSchema }),
});
