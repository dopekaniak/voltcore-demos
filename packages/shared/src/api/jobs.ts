import { z } from 'zod';
import { defineRoute, idParam } from './route';

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(['GENERATE', 'REFINE', 'RETEXTURE', 'REMESH', 'FORGE_BUILD', 'FORGE_EXPORT', 'MESH_ANALYZE', 'PRINT_QUOTE']),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'RETRYING', 'FAILED', 'CANCELED']),
  progress: z.number().int(),
  forge_state: z.string().nullable(),
  attempt: z.number().int(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  reserved_credits: z.number().int(),
  committed_credits: z.number().int(),
  parent_job_id: z.string().nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type JobDto = z.infer<typeof jobSchema>;

export const getJob = defineRoute({ method: 'GET', path: '/v1/jobs/:id', summary: 'Get a job', tag: 'jobs', auth: 'user', params: idParam, response: jobSchema });
export const jobEvents = defineRoute({
  method: 'GET',
  path: '/v1/jobs/:id/events',
  summary: 'Job events as Server-Sent Events; resume with Last-Event-ID',
  tag: 'jobs',
  auth: 'user',
  params: idParam,
  sse: true,
});
export const cancelJob = defineRoute({ method: 'POST', path: '/v1/jobs/:id/cancel', summary: 'Cancel a queued or running job (credits released)', tag: 'jobs', auth: 'user', params: idParam, response: jobSchema });
export const retryJob = defineRoute({ method: 'POST', path: '/v1/jobs/:id/retry', summary: 'Retry a failed job as a new job', tag: 'jobs', auth: 'user', params: idParam, status: 202, idempotent: true, response: jobSchema });

export const fileUrl = defineRoute({
  method: 'GET',
  path: '/v1/assets/:id/files/:file_id/url',
  summary: 'A 5-minute signed download URL',
  tag: 'library',
  auth: 'optional',
  params: z.object({ id: z.string(), file_id: z.string() }),
  response: z.object({ url: z.string(), expires_at: z.string(), filename: z.string(), bytes: z.number().int() }),
});
