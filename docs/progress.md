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
