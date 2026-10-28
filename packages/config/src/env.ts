import { z } from 'zod';

/**
 * Environment schema shared by every Node service. `loadEnv` refuses to boot and lists
 * every missing or invalid key. Defaults exist only where a local default is safe.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    APP_SECRET: z.string().min(32, 'must be at least 32 characters'),

    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    API_ORIGIN: z.string().url().default('http://localhost:4000'),
    FORGE_RUNTIME_ORIGIN: z.string().url().default('http://localhost:3002'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    TERMS_VERSION: z.string().default('2026-10-draft'),

    MESH_URL: z.string().url().default('http://localhost:8000'),
    MESH_SERVICE_TOKEN: z.string().min(16).default('dev-mesh-service-token'),

    PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
    MESHY_API_KEY: z.string().optional(),
    MESHY_BASE_URL: z.string().url().default('https://api.meshy.ai/openapi'),
    MOCK_PROVIDER_LATENCY_MS: z.string().default('8000-25000'),

    FORGE_AUTHOR: z.enum(['mock', 'llm']).default('mock'),
    FORGE_BUILD_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    FORGE_BUILD_MEMORY_MB: z.coerce.number().int().positive().default(1024),

    SLICER_MODE: z.enum(['estimate', 'real']).default('estimate'),
    ESTIMATE_ORDERS: z.enum(['block', 'allow-dev']).default('block'),

    PAYMENTS_MODE: z.enum(['mock', 'stripe-test']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    MOCK_STRIPE_WEBHOOK_SECRET: z.string().min(16).default('whsec_mock_local_development_only'),
    STRIPE_TAX_ENABLED: bool.default(false),

    PARTNER_MODE: z.enum(['mock']).default('mock'),

    STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
    STORAGE_DIR: z.string().default('./var/storage'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),

    MAIL_DRIVER: z.enum(['smtp', 'log', 'memory']).default('log'),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Shapewright <no-reply@shapewright.local>'),

    RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().positive().default(60),
    REFUND_SECOND_APPROVAL_MINOR: z.coerce.number().int().nonnegative().default(10000),
    BOOTSTRAP_ADMIN_EMAILS: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.SLICER_MODE === 'real') {
      issue(
        'SLICER_MODE',
        'real is not allowed until ADR-002b records the slicer license decision (rule 6); use estimate',
      );
    }
    if (env.ESTIMATE_ORDERS === 'allow-dev' && env.NODE_ENV === 'production') {
      issue('ESTIMATE_ORDERS', 'allow-dev is refused in production (ADR-010)');
    }
    if (env.PAYMENTS_MODE === 'stripe-test') {
      if (!env.STRIPE_SECRET_KEY) issue('STRIPE_SECRET_KEY', 'required when PAYMENTS_MODE=stripe-test');
      else if (!env.STRIPE_SECRET_KEY.startsWith('sk_test_'))
        issue('STRIPE_SECRET_KEY', 'must be a test-mode key (sk_test_...)');
      if (!env.STRIPE_WEBHOOK_SECRET)
        issue('STRIPE_WEBHOOK_SECRET', 'required when PAYMENTS_MODE=stripe-test');
    }
    if (env.PROVIDER_MODE === 'live' && !env.MESHY_API_KEY) {
      issue('MESHY_API_KEY', 'required when PROVIDER_MODE=live');
    }
    if (env.FORGE_AUTHOR === 'llm') {
      issue('FORGE_AUTHOR', 'llm is not available in Release 1 (no live author ADR yet); use mock');
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[k]) issue(k, 'required when STORAGE_DRIVER=s3');
      }
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_URL) issue('SMTP_URL', 'required when MAIL_DRIVER=smtp');
    if (env.NODE_ENV === 'production') {
      if (env.APP_SECRET.startsWith('dev-')) issue('APP_SECRET', 'set a real secret in production');
      if (env.MESH_SERVICE_TOKEN === 'dev-mesh-service-token')
        issue('MESH_SERVICE_TOKEN', 'set a real token in production');
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Parse and validate the environment. Throws EnvError listing every problem. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings as unset so `.env` files with `KEY=` behave like missing keys.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') cleaned[k] = v;
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => {
      const key = i.path.join('.') || '(root)';
      const missing = i.code === 'invalid_type' && cleaned[key] === undefined;
      return missing ? `${key}: missing` : `${key}: ${i.message}`;
    });
    throw new EnvError(problems);
  }
  return result.data;
}
