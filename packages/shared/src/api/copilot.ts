import { z } from 'zod';
import { defineRoute, idParam } from './route';
import { jobSchema } from './jobs';
import { dimensionSchema, forgeCheckSchema, printerSchema } from './forge';

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
  response: z.object({ featured: z.boolean(), edit_cost: z.number().int(), photo_calibration: z.boolean(), data: z.array(forgeFeatureSchema) }),
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

// ───────────── Printer profiles ─────────────

export const listPrinterProfiles = defineRoute({ method: 'GET', path: '/v1/printer-profiles', summary: 'Printer profiles (generic default first)', tag: 'copilot', auth: 'none', response: z.object({ data: z.array(printerSchema) }) });

export const setForgePrinterProfile = defineRoute({
  method: 'PUT',
  path: '/v1/forges/:id/printer-profile',
  summary: 'Choose the printer profile that drives this forge’s checks (generic takes a bed size)',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  params: idParam,
  body: z.object({ profile_id: z.string(), bed_mm: z.tuple([z.number().min(20).max(2000), z.number().min(20).max(2000), z.number().min(20).max(2000)]).optional() }),
  response: z.object({ printer: printerSchema }),
});

// ───────────── Dimensions and photo calibration ─────────────

export const confirmDimensions = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/dimensions/confirm',
  summary: 'Confirm assumed dimensions (required before export)',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  params: idParam,
  body: z.object({ version_id: z.string().optional(), keys: z.array(z.string()).max(100).optional() }),
  response: z.object({ dimensions: z.record(z.string(), dimensionSchema) }),
});

const point = z.tuple([z.number().finite(), z.number().finite()]);
const line = z.tuple([point, point]);

export const calibrationSchema = z.object({
  id: z.string(),
  photo_upload_id: z.string(),
  line_px: line,
  real_length_mm: z.number(),
  mm_per_px: z.number(),
  image: z.object({ width: z.number().int(), height: z.number().int() }),
  source: z.literal('USER_MEASURED'),
  created_at: z.string(),
});

export const createCalibration = defineRoute({
  method: 'POST',
  path: '/v1/calibrations',
  summary: 'Calibrate a photo: a line across a known edge and its real length in mm',
  tag: 'copilot',
  auth: 'user',
  status: 201,
  body: z.object({ photo_upload_id: z.string(), line_px: line, real_length_mm: z.number() }),
  response: calibrationSchema,
});

export const getCalibration = defineRoute({ method: 'GET', path: '/v1/calibrations/:id', summary: 'A calibration', tag: 'copilot', auth: 'user', params: idParam, response: calibrationSchema });

export const updateCalibration = defineRoute({
  method: 'PATCH',
  path: '/v1/calibrations/:id',
  summary: 'Change a calibration; measured dimensions that use it are updated and marked for rebuild',
  tag: 'copilot',
  auth: 'user',
  params: idParam,
  body: z.object({ real_length_mm: z.number(), line_px: line.optional() }),
  response: z.object({
    calibration: calibrationSchema,
    affected: z.array(z.object({ forge_id: z.string(), version_id: z.string(), key: z.string(), from_mm: z.number(), to_mm: z.number(), needs_rebuild: z.array(z.string()) })),
  }),
});

export const createMeasurement = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/measurements',
  summary: 'Set a dimension from a line measured on a calibrated photo; saves a new version',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  body: z.object({ key: z.string(), line_px: line, calibration_id: z.string().optional(), version_id: z.string().optional() }),
  response: z.object({ key: z.string(), value_mm: z.number(), source: z.literal('measured'), calibration_id: z.string(), job: jobSchema }),
});

// ───────────── Printability checks ─────────────

export const estimateSchema = z.object({
  code: z.literal('ESTIMATE_NOT_CERTIFIED'),
  label: z.string(),
  title: z.string(),
  formula: z.string(),
  inputs: z.record(z.string(), z.union([z.number(), z.string()])),
  assumptions: z.array(z.string()),
  value: z.number(),
  unit: z.string(),
  summary: z.string(),
});

export const getForgeChecks = defineRoute({
  method: 'GET',
  path: '/v1/forges/:id/checks',
  summary: 'Printability checks for a version under a printer profile (computed on the server, cached)',
  tag: 'copilot',
  auth: 'optional',
  params: idParam,
  query: z.object({ version: z.string().optional(), profile_id: z.string().optional() }),
  response: z.object({
    status: z.enum(['ready', 'pending']),
    printer: printerSchema,
    checks: z.array(forgeCheckSchema),
    estimates: z.array(estimateSchema),
    send_to_print_blocked: z.boolean(),
    job: jobSchema.nullable(),
  }),
});

// ───────────── Test sections and export records ─────────────

export const createTestSection = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/test-sections',
  summary: 'Cut a small test section (a feature, or a slab between two planes) and export it as STL',
  tag: 'copilot',
  auth: 'user',
  scope: 'forge:write',
  idempotent: true,
  status: 202,
  params: idParam,
  body: z
    .object({
      version_id: z.string().optional(),
      feature_key: z.string().max(40).optional(),
      plane: z.object({ axis: z.enum(['x', 'y', 'z']), from_mm: z.number().finite(), to_mm: z.number().finite() }).optional(),
    })
    .refine((b) => Boolean(b.feature_key) !== Boolean(b.plane), { message: 'Give a feature_key or a plane, not both' }),
  response: z.object({ job: jobSchema, export_record_id: z.string() }),
});

export const exportRecordSchema = z.object({
  id: z.string(),
  version_id: z.string(),
  format: z.string(),
  plan_code_at_export: z.string(),
  is_test_section: z.boolean(),
  source: z.enum(['server', 'browser']),
  file_id: z.string().nullable(),
  license_snapshot: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const listExportRecords = defineRoute({
  method: 'GET',
  path: '/v1/forges/:id/export-records',
  summary: 'Exports of this forge with their plan and license terms, newest first',
  tag: 'copilot',
  auth: 'user',
  params: idParam,
  response: z.object({ data: z.array(exportRecordSchema) }),
});

export const createBrowserExportRecord = defineRoute({
  method: 'POST',
  path: '/v1/forges/:id/export-records',
  summary: 'Record an export built and downloaded in the browser (free; stores the terms)',
  tag: 'copilot',
  auth: 'user',
  status: 201,
  params: idParam,
  body: z.object({ format: z.enum(['stl', '3mf']), version_id: z.string().optional() }),
  response: exportRecordSchema,
});

// ───────────── Content policy review (admin) ─────────────

export const adminRefusalSummary = defineRoute({
  method: 'GET',
  path: '/admin/refusals',
  summary: 'Refusals in the last N days by path, surface, and category (weekly review)',
  tag: 'admin',
  auth: 'admin',
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
  response: z.object({
    since: z.string(),
    total: z.number().int(),
    distinct_users: z.number().int(),
    by: z.array(z.object({ path: z.string(), surface: z.string(), category: z.string(), count: z.number().int() })),
  }),
});

export const moderationCaseSchema = z.object({ id: z.string(), kind: z.string(), subject_id: z.string(), reason: z.string(), status: z.enum(['OPEN', 'UPHELD', 'RELEASED']), created_at: z.string() });

export const adminListModerationCases = defineRoute({
  method: 'GET',
  path: '/admin/moderation-cases',
  summary: 'Held content waiting for review',
  tag: 'admin',
  auth: 'admin',
  query: z.object({ status: z.enum(['OPEN', 'UPHELD', 'RELEASED']).default('OPEN') }),
  response: z.object({ data: z.array(moderationCaseSchema) }),
});

export const adminDecideModerationCase = defineRoute({
  method: 'POST',
  path: '/admin/moderation-cases/:id/decide',
  summary: 'Uphold (delete) or release held content; reason required, audited',
  tag: 'admin',
  auth: 'admin',
  params: idParam,
  body: z.object({ decision: z.enum(['UPHELD', 'RELEASED']), reason: z.string().trim().min(5).max(500) }),
  response: moderationCaseSchema,
});
