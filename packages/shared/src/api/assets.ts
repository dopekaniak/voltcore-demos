import { z } from 'zod';
import { defineRoute, idParam, okResponse } from './route';

export const visibilityEnum = z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']);

export const patchAsset = defineRoute({
  method: 'PATCH',
  path: '/v1/assets/:id',
  summary: 'Rename an asset or change who can see it',
  tag: 'library',
  auth: 'user',
  scope: 'assets:write',
  params: idParam,
  body: z.object({ title: z.string().trim().min(1).max(120).optional(), visibility: visibilityEnum.optional() }),
  response: z.object({ id: z.string(), title: z.string(), visibility: visibilityEnum }),
});

export const deleteAsset = defineRoute({ method: 'DELETE', path: '/v1/assets/:id', summary: 'Delete an asset (soft delete)', tag: 'library', auth: 'user', scope: 'assets:write', params: idParam, response: okResponse });
