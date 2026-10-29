import { z } from 'zod';
import { defineRoute, idParam } from './route';
import { quoteSchema, printSettingsInput } from './print';

export const licenseSchema = z.object({
  code: z.string(),
  name: z.string(),
  text: z.string(),
  attribution_template: z.string(),
  allows_commercial: z.boolean(),
  allows_derivatives: z.boolean(),
  allows_print_order: z.boolean(),
  personal_print_only: z.boolean(),
});
export const licenseBlock = z.object({ code: z.string(), name: z.string(), attribution: z.string(), allows_print_order: z.boolean(), allows_derivatives: z.boolean(), allows_commercial: z.boolean() });

export const listLicenses = defineRoute({ method: 'GET', path: '/v1/licenses', summary: 'Supported licenses', tag: 'library', auth: 'none', response: z.object({ data: z.array(licenseSchema) }) });

export const setAssetLicense = defineRoute({
  method: 'PUT',
  path: '/v1/assets/:id/license',
  summary: 'Set the license and attribution of an asset you own',
  tag: 'library',
  auth: 'user',
  scope: 'assets:write',
  params: idParam,
  body: z.object({ code: z.string().max(40), attribution_text: z.string().max(500).optional(), source_url: z.string().url().max(500).optional(), custom_text: z.string().min(20).max(20000).optional() }),
  response: licenseBlock,
});

export const SAFETY_CLASSES = ['NONE', 'COSMETIC', 'ENCLOSURE', 'SAFETY_CRITICAL'] as const;
export const partSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  part_number_text: z.string().nullable(),
  safety_class: z.enum(SAFETY_CLASSES),
  status: z.string(),
  license: licenseBlock.nullable(),
  asset_id: z.string().nullable(),
  print: z.object({ orderable: z.boolean(), reason: z.string().nullable(), allowed_materials: z.array(z.string()) }),
  safety_warning: z.string().nullable(),
  fit_disclaimer: z.string(),
  is_owner: z.boolean(),
  fitments: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const createPart = defineRoute({
  method: 'POST',
  path: '/v1/parts',
  summary: 'Create a catalog part (draft) from a model you own',
  tag: 'parts',
  auth: 'user',
  scope: 'assets:write',
  status: 201,
  body: z.object({
    asset_id: z.string(),
    title: z.string().trim().min(3).max(120),
    description: z.string().max(5000).default(''),
    category: z.string().trim().min(2).max(60),
    part_number_text: z.string().max(80).optional(),
    safety_class: z.enum(SAFETY_CLASSES).default('NONE'),
    print_order_allowed: z.boolean().default(false),
    allowed_materials: z.array(z.string().max(20)).max(10).default(['PETG', 'ASA']),
  }),
  response: partSchema,
});

export const getPart = defineRoute({ method: 'GET', path: '/v1/parts/:id', summary: 'A catalog part with fitments, safety class, license, and print status', tag: 'parts', auth: 'optional', params: idParam, response: partSchema });

export const partPrintQuote = defineRoute({
  method: 'POST',
  path: '/v1/parts/:id/print-quotes',
  summary: 'Quote a printed copy of a catalog part (blocked for safety-critical parts and licenses that forbid print orders)',
  tag: 'parts',
  auth: 'user',
  scope: 'print:write',
  idempotent: true,
  status: 201,
  params: idParam,
  body: z.object({ acknowledge_fit: z.boolean(), settings: printSettingsInput.optional() }),
  response: z.object({ part_id: z.string(), quote: quoteSchema }),
});

export const adminSafetyClass = defineRoute({
  method: 'POST',
  path: '/admin/parts/:id/safety-class',
  summary: 'Set a part safety class (reason required, audited)',
  tag: 'admin',
  auth: 'admin',
  params: idParam,
  body: z.object({ safety_class: z.enum(SAFETY_CLASSES), reason: z.string().trim().min(5).max(500) }),
  response: partSchema,
});
