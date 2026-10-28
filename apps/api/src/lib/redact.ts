/** Header and field names whose values never reach logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.token',
  '*.secret',
];

const SECRET_PATTERNS = [/sk_(test|live)_[A-Za-z0-9]+/g, /sw_(live|test)_[A-Za-z0-9]+/g, /msy_[A-Za-z0-9]+/g, /whsec_[A-Za-z0-9_]+/g];

/** Scrub secrets that appear inside free text (error messages, URLs). */
export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((t, re) => t.replace(re, '[REDACTED]'), text);
}
