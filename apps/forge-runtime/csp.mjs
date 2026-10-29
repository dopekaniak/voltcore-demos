/** Headers for the forge sandbox origin (ADR-008). Shared by the dev server and serve.mjs. */
export function sandboxHeaders(webOrigin, dev = false) {
  const csp = [
    "default-src 'none'",
    `script-src 'self' blob: 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ''}`,
    "worker-src 'self' blob:",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "img-src 'self' blob: data:",
    "style-src 'self'",
    `frame-ancestors ${webOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
