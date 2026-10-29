# Progress

One entry per slice: what shipped, the check commands with exit codes, and what is mocked.

## Slice 1 — Docs

Shipped: `docs/product.md`, `docs/architecture.md`, `docs/decisions.md` (ADR-000 to ADR-018,
provider choice, open questions), `docs/pricing.md` (formula, config v1, three worked
examples, estimator), `docs/security.md`, `docs/risks.md`, `LICENSE-AUDIT.md`.

Checks: no code yet; lint, typecheck, and test commands arrive with slice 2.

Verified before writing (2026-10-28): partforge 0.166.0 builds, verifies, and exports
STL/3MF (Manifold) and STEP (OCCT) headlessly on Node 22; Meshy docs read for ADR-006.

## Slice 2 — Foundation

Shipped: pnpm + Turborepo monorepo (`apps/api`, `apps/worker`, `apps/mesh`, `packages/config`,
`packages/shared`, `packages/db`, `packages/pricing`), TypeScript strict base config, ESLint
flat config, Prettier, Zod environment schema that refuses to boot and lists every missing
key (refuses `SLICER_MODE=real`, `ESTIMATE_ORDERS=allow-dev` in production, Stripe live
keys), `.env.example`, `infra/docker-compose.yml` (postgres 16, redis 7, minio, mailpit,
mesh), Prisma schema for all Release 1 core tables and the first migration (with CHECK
constraints, append-only triggers on ledger/job events/order events/audit log, partial
index on queued/retrying jobs, trigram index on asset titles), idempotent seeds (plans,
packs, materials, two mock partners with printers, pricing v1, mock and live model
catalog), `GET /v1/health`, mesh `/health`, CI workflow, `scripts/check.sh`.

Checks: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (config 7, shared 8, db 5,
pricing 2, api 4, mesh 2).

Notes: Docker is not available on the build machine, so local runs use the host's
Postgres 16 and Redis 7; compose is provided for other machines.

## Slice 3 — Accounts and credits

Shipped: magic-link sign-in (single-use, SHA-256 hashed, 15-minute expiry, no account
enumeration, open-redirect guard), sessions with rotation on login and logout, TOTP
enrollment and verification (RFC 6238, encrypted secret), admin route gate requiring
role + TOTP-verified session, Origin check for cookie-authenticated mutations, API keys
with scopes (hashed, shown once, revocable; `403 INSUFFICIENT_SCOPE`), webhook endpoint CRUD
and signed test delivery, rate limits (60/min users, plan limits for keys, `429` with
`Retry-After`), credit wallet service (reserve/commit/release/expire/adjust with row
locks and idempotency keys), credit grant buckets (monthly plan credits expire, packs do
not), `GET /v1/billing/wallet` and `/v1/billing/ledger`, owner-scoped repositories with a
scope test, shared Zod route definitions, state machines for job, forge build, order,
order item, and reservation with exhaustive transition tests. Worker: outbox relay,
email processor (log/memory/SMTP drivers), webhook delivery with retries, reaper
(stale reservations, grant expiry, Free plan renewal).

Checks: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (config 7, shared 26 including
the 10,000-run credit property test, db 34, pricing 2, worker 6, api 26, mesh 2).

Mocked: email is logged (`MAIL_DRIVER=log`) unless SMTP/Mailpit is configured.

## Slice 4 — Forge core

Shipped:
- `packages/forge-kit`: partforge-based model contract (ADR-007), schema extraction from
  partforge control sections, parameter validation and clamping with plain-language
  messages, AST static check with an import allowlist and denylist (ADR-008, ADR-021),
  import rewriting for sandbox evaluation, DFM profile `fdm-0.4mm-nozzle` and check rows
  ("Wall is 0.8 mm; the printer minimum is 1.2 mm"), `FormAuthor` interface and
  `MockAuthor` (ADR-023), four original starter forges (cable clip, box with snap-fit lid,
  planter, filleted box), the server sandbox runner (permission-model child process, RSS
  watchdog, 20 s kill, network stubs), and the browser worker.
- `apps/forge-runtime`: sandboxed cross-origin iframe relay + Web Worker, strict CSP,
  20 s timeout with worker restart, build coalescing.
- `packages/storage`: fs driver with HMAC-signed URLs (5 min GET / 15 min PUT) and an S3
  driver.
- Job engine in `@sw/db`: create (reservation + outbox in one transaction), claim,
  progress, forge build states, succeed (commit), fail/retry (release), cancel (release),
  retry-as-new; developer webhook fan-out on job success/failure.
- Worker: FORGE_BUILD agent loop with one repair attempt; FORGE_EXPORT for STL, 3MF, and
  STEP (OCCT) with 7-day expiry; thumbnails rendered in the sandbox.
- API: `GET /v1/forges/starters[/:key]`, `POST /v1/forges`, `GET /v1/forges/:id`,
  `GET /v1/forges/:id/versions`, `PATCH /v1/forges/:id/params`, `POST /v1/forges/:id/exports`,
  `GET /v1/jobs/:id`, `GET /v1/jobs/:id/events` (SSE with `Last-Event-ID`),
  `POST /v1/jobs/:id/cancel|retry`, `GET /v1/assets/:id/files/:file_id/url`, `/files/*`;
  generic `Idempotency-Key` replay with `409 IDEMPOTENCY_KEY_REUSED`.
- `packages/ui`: tokens (light/dark), brand components, the shared three.js viewer (orbit,
  pan, zoom, F/R/arrow keys, wireframe, bounding box readout, 10 mm grid, overhang tint).
- `apps/web`: shell with Create menu, credit badge, account menu, theme cookie, mobile
  bottom tabs; home (prompt, examples, starters), sign-in and callback, forge build
  progress, forge page (viewer, parameters, checks, STL/3MF in-browser export, STEP server
  export, code viewer, Send-to-print gate), starter preview, billing, developers, status,
  404/500, legal drafts. All copy in `src/lib/messages.ts`. CSP with nonces.

Checks: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (config 7, shared 26, db 34,
pricing 2, storage 3, forge-kit 68, api 26, worker 18, mesh 2). `pnpm e2e`: J1, J1b
(starter without account), clamp message, J2 — 4 passed. `pnpm --filter @sw/web build` 0.

Mocked: forge author (`FORGE_AUTHOR=mock`). Library, Generate, and Print pages are
placeholders until slices 6 and 7.
