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
