import { z } from 'zod';
import { defineRoute } from './route';
import { jobSchema } from './jobs';

export const modelSchema = z.object({
  code: z.string(),
  name: z.string(),
  provider: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  costs: z.record(z.string(), z.number().int()),
});

export const listModels = defineRoute({ method: 'GET', path: '/v1/models', summary: 'Generation models with capabilities and credit costs', tag: 'generate', auth: 'none', response: z.object({ data: z.array(modelSchema) }) });

export const ESTIMATE_KINDS = ['preview', 'refine', 'image', 'retexture', 'remesh'] as const;
export const getEstimate = defineRoute({
  method: 'GET',
  path: '/v1/estimates',
  summary: 'Credit cost for an operation',
  tag: 'generate',
  auth: 'none',
  query: z.object({ kind: z.enum(ESTIMATE_KINDS), model: z.string().optional() }),
  response: z.object({ kind: z.string(), model: z.string(), credits: z.number().int() }),
});

const prompt = z.string().trim().min(1).max(600);

export const textTo3d = defineRoute({
  method: 'POST',
  path: '/v1/generations/text-to-3d',
  summary: 'Text to 3D: a preview (shape only) or a refine (textured) of a succeeded preview',
  tag: 'generate',
  auth: 'user',
  scope: 'generate:write',
  idempotent: true,
  status: 202,
  body: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('preview'),
      prompt,
      model: z.string().optional(),
      style: z.enum(['realistic', 'stylized', 'low-poly', 'sculpture']).optional(),
      topology: z.enum(['triangle', 'quad']).optional(),
      polycount: z.number().int().min(100).max(300_000).optional(),
    }),
    z.object({ mode: z.literal('refine'), preview_job_id: z.string(), texture_prompt: z.string().trim().max(600).optional() }),
  ]),
  response: z.object({ job: jobSchema }),
});

export const imageTo3d = defineRoute({
  method: 'POST',
  path: '/v1/generations/image-to-3d',
  summary: 'Image to 3D from 1-4 uploaded images',
  tag: 'generate',
  auth: 'user',
  scope: 'generate:write',
  idempotent: true,
  status: 202,
  body: z.object({ upload_ids: z.array(z.string()).min(1).max(4), model: z.string().optional(), remove_background: z.boolean().default(false), title: z.string().trim().max(120).optional() }),
  response: z.object({ job: jobSchema }),
});

export const retexture = defineRoute({
  method: 'POST',
  path: '/v1/generations/retexture',
  summary: 'Retexture an asset version you own',
  tag: 'generate',
  auth: 'user',
  scope: 'generate:write',
  idempotent: true,
  status: 202,
  body: z.object({ asset_version_id: z.string(), prompt, model: z.string().optional() }),
  response: z.object({ job: jobSchema }),
});

export const remesh = defineRoute({
  method: 'POST',
  path: '/v1/generations/remesh',
  summary: 'Remesh an asset version you own to a target face count (runs in the mesh service)',
  tag: 'generate',
  auth: 'user',
  scope: 'generate:write',
  idempotent: true,
  status: 202,
  body: z.object({ asset_version_id: z.string(), target_faces: z.number().int().min(100).max(2_000_000) }),
  response: z.object({ job: jobSchema }),
});
