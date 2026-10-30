import { z } from 'zod';

/** Every error code the API can return, with its HTTP status. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  PAYMENT_REQUIRED: 402,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  TOTP_REQUIRED: 403,
  ORIGIN_MISMATCH: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_STATE: 409,
  QUOTE_CHANGED: 409,
  QUOTE_EXPIRED: 409,
  ESTIMATE_NOT_ORDERABLE: 409,
  CHECKS_NOT_ACKNOWLEDGED: 409,
  MIXED_CURRENCY: 422,
  PART_TOO_LARGE: 422,
  SCALE_OUT_OF_RANGE: 422,
  QUANTITY_OUT_OF_RANGE: 422,
  UPLOAD_REJECTED: 422,
  MAGIC_LINK_INVALID: 400,
  TOTP_INVALID: 400,
  FORGE_STATIC_CHECK_FAILED: 422,
  FORGE_BUILD_FAILED: 422,
  FORGE_BUILD_TIMEOUT: 422,
  PROVIDER_ERROR: 502,
  PROVIDER_CREATE_UNCERTAIN: 502,
  MESH_SERVICE_ERROR: 502,
  NOT_IMPLEMENTED: 501,
  PROHIBITED_ITEM: 422,
  PART_NOT_READY: 409,
  PART_NOT_PRINTABLE: 403,
  LICENSE_FORBIDS_PRINT: 403,
  LICENSE_FORBIDS_DERIVATIVE: 403,
  LICENSE_MISSING: 422,
  FITMENT_UNVERIFIED: 409,
  DESIGN_NOT_APPROVED: 409,
  CUSTOMIZER_INPUT_INVALID: 422,
  FEATURE_AMBIGUOUS: 409,
  AUTHOR_DECLINED: 422,
  FORGE_NOT_FEATURED: 409,
  CALIBRATION_REQUIRED: 409,
  CALIBRATION_INVALID: 422,
  ESTIMATE_NOT_CERTIFIED: 200,
  MODEL_NOT_PUBLIC: 404,
  UPLOAD_LIMIT_EXCEEDED: 422,
  FIT_DISCLAIMER_REQUIRED: 409,
  PREVIEW_NOT_READY: 409,
  RATE_LIMITED: 429,
  WEBHOOK_SIGNATURE_INVALID: 400,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_CODES[code];
  }
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
    request_id: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function errorEnvelope(err: AppError, requestId: string): ErrorEnvelope {
  return { error: { code: err.code, message: err.message, details: err.details, request_id: requestId } };
}
