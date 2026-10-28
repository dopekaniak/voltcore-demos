# Security

Each item below has an automated test. The test file is named next to the item; the table
at the end tracks status per slice.

## Forge sandbox (rule 3, ADR-008)

- AI-written model code runs only in a Web Worker inside a sandboxed, cross-origin iframe
  (browser) or in a permission-restricted child process (server). It never runs in the web
  app's page context and never in the API process.
- Static check before any build: imports only from `partforge` and its subpaths; no dynamic
  `import()`, `require`, `eval`, `Function`, `process`, `globalThis`, network APIs,
  `__proto__`, or `constructor` access.
- Server child process: Node permission model (read-only fs to the code and `node_modules`,
  no fs write, no child processes, no worker threads, no addons), `--max-old-space-size`
  memory cap, network globals removed and socket connects stubbed, SIGKILL at 20 s.
- Browser: runtime origin CSP `default-src 'none'`, `connect-src 'self'` (static files only),
  `frame-ancestors` limited to the web origin; worker terminated after 20 s.
- Test: a model that calls `fetch`, a model that imports an unlisted module, and a model
  with an infinite loop each fail safely (`packages/forge-kit/test/sandbox.test.ts`).

## Uploads

- Extension and MIME allowlist (STL, OBJ, 3MF for print; PNG, JPEG, WebP for images).
- Magic-byte check (binary STL header/size consistency or ASCII `solid`; 3MF ZIP
  signature; OBJ text sniff; image signatures).
- Size limits: 150 MB print files, 20 MB images. Presigned PUTs are bound to length and type.
- 3MF zip-bomb limits: 500 MB uncompressed total, 5,000 entries, checked from the central
  directory before inflating.
- Triangle cap: 25 million.
- Files stay under `quarantine/` until the scan passes, then move to `files/`.

## Files

- Signed URLs only: 5-minute downloads, 15-minute uploads.
- Private assets return `404` (not `403`) to non-owners.

## Authorization (IDOR)

- Every repository method takes an owner scope; a test fails if one does not
  (`packages/db/test/repo-scope.test.ts`).
- IDOR tests: user A cannot read or change user B's forge, asset, job, quote, cart, order,
  API key, or webhook endpoint (`apps/api/test/idor.test.ts`).

## Money

- The server recomputes every price. A client-supplied amount is ignored.
- Before an order becomes `PAID`, the Stripe session amount and currency must equal the
  quote total.
- Idempotency keys on every Stripe call and every money-moving endpoint.

## Webhooks

- Stripe: signature checked on the raw body; raw event stored; processed once inside a
  transaction; duplicates ignored by event ID.
- Generation provider: no documented signature (ADR-006), so the body is not trusted; the
  task is fetched by GET before state changes. Dedupe on `task id + status`.
- State only moves forward: a late in-progress event never overwrites a final state.

## Authentication

- Magic links are single-use, stored as SHA-256 hashes, and expire in 15 minutes.
- Sessions rotate on login (the previous session cookie's session is revoked).
- Admin and ops accounts must verify TOTP (RFC 6238) before any `/admin` route.
- Cookie sessions: `HttpOnly`, `SameSite=Lax`, `Secure` in production; state-changing
  requests with a cookie session must carry an `Origin` that matches `WEB_ORIGIN`.
- API keys are stored as SHA-256 hashes with a visible prefix and scopes; a key without the
  required scope gets `403 INSUFFICIENT_SCOPE`.

## Headers and logs

- Web: strict CSP with per-request nonces, HSTS, `Permissions-Policy: camera=(), microphone=()`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- API: the same security headers; `X-Request-Id` on every response.
- Logs redact `authorization`, `cookie`, `set-cookie`, `stripe-signature`, and API keys.

## Rate limits

- 60 requests/min for signed-in users; API keys by plan (600/min Creator, 3,000/min Studio);
  `429` with `Retry-After`.

## Status by slice

| Item | Test | Slice |
| --- | --- | --- |
| Forge sandbox | `packages/forge-kit/test/sandbox.test.ts` | 4 |
| Uploads | `apps/api/test/uploads.test.ts`, `apps/mesh/tests` | 7 |
| Signed URLs, 404 on private | `apps/api/test/files.test.ts` | 6 |
| IDOR | `apps/api/test/idor.test.ts` | 3, extended each slice |
| Repo owner scope | `packages/db/test/repo-scope.test.ts` | 3 |
| Money checks | `apps/api/test/checkout.test.ts` | 8 |
| Webhook dedupe and ordering | `apps/api/test/webhooks.test.ts`, `packages/providers/test` | 6, 8 |
| Magic link, sessions, TOTP | `apps/api/test/auth.test.ts` | 3 |
| Headers and log redaction | `apps/api/test/headers.test.ts` | 3, 9 |
| Rate limits | `apps/api/test/ratelimit.test.ts` | 3 |
