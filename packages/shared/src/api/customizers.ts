import { z } from 'zod';
import { defineRoute, idParam } from './route';
import { jobSchema } from './jobs';
import { clampSchema } from './forge';

export const customizerSummary = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  takes_image: z.boolean(),
  license: z.object({ code: z.string(), name: z.string(), attribution: z.string() }).nullable(),
});

export const customizerDetail = customizerSummary.extend({
  code: z.string(),
  schema: z.record(z.string(), z.unknown()),
  input_rules: z.record(z.string(), z.unknown()),
  export: z.object({ cost: z.number().int(), free_remaining: z.number().int(), formats: z.array(z.string()), footer: z.string().nullable() }),
});

export const listCustomizers = defineRoute({ method: 'GET', path: '/v1/customizers', summary: 'Live customizers', tag: 'customizers', auth: 'none', response: z.object({ data: z.array(customizerSummary) }) });
export const getCustomizer = defineRoute({ method: 'GET', path: '/v1/customizers/:id', summary: 'A customizer with its code, inputs, and your export allowance', tag: 'customizers', auth: 'optional', params: idParam, response: customizerDetail });

const inputs = z.record(z.string(), z.unknown());
export const previewCustomizer = defineRoute({
  method: 'POST',
  path: '/v1/customizers/:id/previews',
  summary: 'Validate inputs for a preview (previews are built in the browser and are free)',
  tag: 'customizers',
  auth: 'optional',
  params: idParam,
  body: z.object({ inputs }),
  response: z.object({ values: z.record(z.string(), z.unknown()), clamped: z.array(clampSchema) }),
});

export const customizerRelief = defineRoute({
  method: 'POST',
  path: '/v1/customizers/:id/relief',
  summary: 'Turn an uploaded image into the relief height map for this customizer',
  tag: 'customizers',
  auth: 'user',
  params: idParam,
  body: z.object({ upload_id: z.string() }),
  response: z.object({ width: z.number().int(), height: z.number().int(), data: z.array(z.number().int()) }),
});

export const exportCustomizer = defineRoute({
  method: 'POST',
  path: '/v1/customizers/:id/exports',
  summary: 'Export a customized model (free allowance, then credits)',
  tag: 'customizers',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  body: z.object({ inputs, format: z.enum(['stl', '3mf']), image_upload_id: z.string().optional() }),
  response: z.object({ job: jobSchema, free: z.boolean(), credits: z.number().int(), footer: z.string().nullable(), clamped: z.array(clampSchema) }),
});

export const jobFileUrl = defineRoute({
  method: 'GET',
  path: '/v1/jobs/:id/file',
  summary: 'Signed URL for the file a job produced',
  tag: 'jobs',
  auth: 'user',
  params: idParam,
  response: z.object({ url: z.string(), filename: z.string(), bytes: z.number().int() }),
});
