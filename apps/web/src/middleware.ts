import { NextResponse, type NextRequest } from 'next/server';

/** Strict CSP with a per-request nonce, HSTS, and Permissions-Policy (docs/security.md). */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const runtime = process.env.NEXT_PUBLIC_FORGE_RUNTIME_ORIGIN ?? 'http://localhost:3002';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `frame-src ${runtime}`,
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!dev) res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return res;
}

export const config = { matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'] };
