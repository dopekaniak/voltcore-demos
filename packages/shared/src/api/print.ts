import { z } from 'zod';
import { defineRoute, idParam, okResponse } from './route';
import { jobSchema } from './jobs';

export const printSettingsInput = z.object({
  material: z.string().max(20).optional(),
  color: z.string().max(30).optional(),
  layer_height_um: z.number().int().optional(),
  infill_pct: z.number().int().optional(),
  supports: z.enum(['auto', 'none']).optional(),
  orientation: z.enum(['as-uploaded', 'auto']).optional(),
  scale_pct: z.number().optional(),
  quantity: z.number().int().optional(),
  shipping: z.enum(['standard', 'express']).optional(),
});

export const printPartSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['UPLOADED', 'SCANNING', 'ANALYZING', 'NEEDS_REPAIR', 'REPAIRING', 'READY', 'REJECTED']),
  source: z.enum(['upload', 'asset', 'forge']),
  analysis: z.record(z.string(), z.unknown()).nullable(),
  repair: z.object({ before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()), actions: z.array(z.string()) }).nullable(),
  use_repaired: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  checks_failing: z.boolean(),
  checks_acknowledged: z.boolean(),
  job_id: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export const quoteLineSchema = z.object({
  part_id: z.string(),
  material: z.string(),
  quantity: z.number().int(),
  unit_price_minor: z.number().int(),
  setup_fee_minor: z.number().int(),
  line_total_minor: z.number().int(),
  discount_bps: z.number().int(),
  filament_g: z.number(),
  support_g: z.number(),
  print_time_h: z.number(),
});

export const quoteSchema = z.object({
  id: z.string(),
  part_id: z.string(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'SUPERSEDED', 'ORDERED']),
  is_estimate: z.boolean(),
  orderable: z.boolean(),
  currency: z.string(),
  lines: z.array(quoteLineSchema),
  subtotal_minor: z.number().int(),
  shipping_minor: z.number().int(),
  tax_minor: z.number().int(),
  total_minor: z.number().int(),
  tax_note: z.string(),
  pricing_version: z.number().int(),
  lead_time_days: z.number().int(),
  settings: z.record(z.string(), z.unknown()),
  expires_at: z.string(),
  created_at: z.string(),
});

export const createPart = defineRoute({
  method: 'POST',
  path: '/v1/print/parts',
  summary: 'Create a print part from an upload, a library model version, or a forge at given parameters',
  tag: 'print',
  auth: 'optional',
  scope: 'print:write',
  idempotent: true,
  status: 201,
  body: z.union([
    z.object({ upload_id: z.string() }),
    z.object({ asset_version_id: z.string() }),
    z.object({ forge_id: z.string(), version_id: z.string().optional(), params: z.record(z.string(), z.unknown()).default({}), acknowledge_checks: z.boolean().default(false) }),
  ]),
  response: z.object({ part: printPartSchema }),
});

export const getPart = defineRoute({ method: 'GET', path: '/v1/print/parts/:id', summary: 'A print part with its validation report', tag: 'print', auth: 'optional', scope: 'print:read', params: idParam, response: z.object({ part: printPartSchema }) });

export const patchPart = defineRoute({
  method: 'PATCH',
  path: '/v1/print/parts/:id',
  summary: 'Change print settings; returns a fresh quote',
  tag: 'print',
  auth: 'optional',
  scope: 'print:write',
  params: idParam,
  body: z.object({ settings: printSettingsInput.default({}), use_repaired: z.boolean().optional(), acknowledge_checks: z.boolean().optional() }),
  response: z.object({ part: printPartSchema, quote: quoteSchema.nullable() }),
});

export const partMeshUrl = defineRoute({
  method: 'GET',
  path: '/v1/print/parts/:id/mesh',
  summary: 'Signed URL for the part mesh (source or repaired)',
  tag: 'print',
  auth: 'optional',
  scope: 'print:read',
  params: idParam,
  query: z.object({ which: z.enum(['source', 'repaired']).default('source') }),
  response: z.object({ url: z.string(), format: z.string() }),
});

export const repairPart = defineRoute({
  method: 'POST',
  path: '/v1/print/parts/:id/repair',
  summary: 'Repair the mesh for printing (keeps the original)',
  tag: 'print',
  auth: 'optional',
  scope: 'print:write',
  idempotent: true,
  status: 202,
  params: idParam,
  response: z.object({ job: jobSchema }),
});

export const createQuote = defineRoute({
  method: 'POST',
  path: '/v1/print/quotes',
  summary: 'Price a part (estimate mode until a slicer is approved); valid for 30 minutes',
  tag: 'print',
  auth: 'optional',
  scope: 'print:write',
  idempotent: true,
  status: 201,
  body: z.object({ part_id: z.string(), settings: printSettingsInput.optional() }),
  response: quoteSchema,
});

export const getQuote = defineRoute({ method: 'GET', path: '/v1/print/quotes/:id', summary: 'A quote', tag: 'print', auth: 'optional', scope: 'print:read', params: idParam, response: quoteSchema });

export const claimQuote = defineRoute({ method: 'POST', path: '/v1/print/quotes/:id/claim', summary: 'Attach an anonymous quote and its part to the signed-in user', tag: 'print', auth: 'session', params: idParam, response: quoteSchema });

export const cartSchema = z.object({
  id: z.string(),
  currency: z.string(),
  items: z.array(z.object({ id: z.string(), part_id: z.string(), title: z.string(), quote: quoteSchema, stale: z.boolean() })),
  subtotal_minor: z.number().int(),
  shipping_minor: z.number().int(),
  total_minor: z.number().int(),
  orderable: z.boolean(),
});

export const getCart = defineRoute({ method: 'GET', path: '/v1/cart', summary: 'Your cart', tag: 'cart', auth: 'user', scope: 'print:read', response: cartSchema });
export const addCartItem = defineRoute({ method: 'POST', path: '/v1/cart/items', summary: 'Add a quoted part to the cart (the server reprices)', tag: 'cart', auth: 'user', scope: 'print:write', status: 201, body: z.object({ quote_id: z.string() }), response: cartSchema });
export const patchCartItem = defineRoute({ method: 'PATCH', path: '/v1/cart/items/:id', summary: 'Point a cart item at a newer quote', tag: 'cart', auth: 'user', scope: 'print:write', params: idParam, body: z.object({ quote_id: z.string() }), response: cartSchema });
export const deleteCartItem = defineRoute({ method: 'DELETE', path: '/v1/cart/items/:id', summary: 'Remove a cart item', tag: 'cart', auth: 'user', scope: 'print:write', params: idParam, response: cartSchema });
export const clearCart = defineRoute({ method: 'DELETE', path: '/v1/cart', summary: 'Empty the cart', tag: 'cart', auth: 'user', scope: 'print:write', response: okResponse });
