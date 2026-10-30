import { z } from 'zod';
import { defineRoute, idParam } from './route';

export const UPLOAD_TYPES = {
  print: { stl: ['model/stl', 'application/sla', 'application/octet-stream'], obj: ['model/obj', 'text/plain', 'application/octet-stream'], '3mf': ['model/3mf', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', 'application/octet-stream'] },
  image: { png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], webp: ['image/webp'] },
} as const;
export const UPLOAD_LIMITS = { print: 150 * 1024 * 1024, image: 20 * 1024 * 1024 } as const;

export const uploadSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'UPLOADED', 'SCANNING', 'CLEAN', 'REJECTED', 'FLAGGED']),
  purpose: z.enum(['print', 'image']),
  filename: z.string(),
  bytes: z.number().int(),
  reject_reason: z.string().nullable(),
  expires_at: z.string(),
});

export const createUpload = defineRoute({
  method: 'POST',
  path: '/v1/uploads',
  summary: 'Start an upload: returns a presigned PUT (15 min) bound to the length and type',
  tag: 'uploads',
  auth: 'optional',
  status: 201,
  body: z.object({ filename: z.string().min(1).max(200), content_type: z.string().max(100), bytes: z.number().int().positive(), purpose: z.enum(['print', 'image']) }),
  response: z.object({ upload: uploadSchema, put: z.object({ url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expires_at: z.string() }) }),
});

export const completeUpload = defineRoute({
  method: 'POST',
  path: '/v1/uploads/:id/complete',
  summary: 'Finish an upload: checks size, type, and content; moves it out of quarantine when clean',
  tag: 'uploads',
  auth: 'optional',
  params: idParam,
  response: z.object({ upload: uploadSchema, analysis: z.record(z.string(), z.unknown()).nullable() }),
});
