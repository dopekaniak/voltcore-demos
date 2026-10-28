# Decisions log

Each entry records the decision, why, and the alternatives rejected. Open questions are at
the end; each has the option chosen for now so work can continue.

## Plan (posted before slice 1)

- **Live generation provider:** Meshy (`https://api.meshy.ai/openapi/`). It has a public,
  documented REST API with the two-step preview → refine flow the product needs, a
  documented task lifecycle, documented webhook delivery rules, and a published credit
  table. See ADR-006.
- **Forge author:** `MockAuthor` first. It maps a prompt to one of the bundled starter
  forges by keyword scoring, and fills dimensions it can read from the prompt (for example
  "40 mm", "6 mm cable"). The live LLM author waits for Release 2 and an ADR.
- **Three biggest risks:** (1) running untrusted, AI-written geometry code safely in both
  the browser and the server; (2) quoting without a real slicer (estimate accuracy, and
  the rule that estimates cannot be ordered); (3) money correctness across webhooks that
  repeat or arrive out of order. See `docs/risks.md` for the full list.

---

## ADR-000 — Brand

**Decision:** the brand is **Shapewright**, tagline "describe it, forge it, print it".
Accent colour orange `#C2410C` (5.2:1 on white), neutral grays, semantic green/amber/red.
The logo is an original geometric mark (a wrench-like chevron over a layer stack) drawn as
inline SVG.
**Rejected:** names close to existing 3D products; any reuse of other products' marks.
**Open:** trademark clearance has not been done (see open questions).

## ADR-001 — Fastify for the API

**Decision:** Fastify 5. Content-type parsers can keep the raw body per route, which keeps
Stripe and provider webhook signature checks simple; SSE is a plain reply stream.
**Rejected:** Express (weaker typing and schema hooks), NestJS (heavier than the API needs),
Next.js route handlers (would couple the developer API to the web deploy).

## ADR-002 — Python mesh service

**Decision:** a Python 3.12 FastAPI service (`apps/mesh`) using trimesh and numpy for
analyze, repair, convert, and remesh. It is internal only (bound to the private network;
the API and worker call it with a shared service token).
**Rejected:** doing mesh repair in Node (no mature equivalent of trimesh's repair and
analysis tooling).
**Note:** local development in this repository was verified on Python 3.13; the container
image pins 3.12. The code uses nothing that differs between the two.

## ADR-002b — Slicer (deferred)

**Decision:** no slicer is linked, bundled, or called by any shipped service.
`SLICER_MODE=estimate` is the only accepted value; `real` is refused by the environment
schema. Print time and filament mass come from the deterministic estimator in
`packages/pricing` (inputs from mesh analysis).
**Why:** PrusaSlicer and CuraEngine are AGPL-3.0 (verified from their repositories on
2026-10-28); Bambu Studio is reported as AGPL-3.0. Network use and modification carry
obligations that need counsel review.
**Before changing:** write the license analysis here, get counsel review, and only then add
a slicer container. Candidate path: a permissively licensed or commercially licensed
slicer, called as a separate process.

## ADR-003 — partforge for forge geometry

**Decision:** forge geometry uses the `partforge` npm package (0.166.0, MIT, verified from
its published package metadata on 2026-10-28). It provides the Manifold kernel (previews,
STL, 3MF, mesh fillets) and the Replicad/OpenCASCADE kernel (exact B-rep, STEP). The repo
depends on it and does not copy its source.
**Verified behaviour (2026-10-28, headless in Node 22):** `bootManifoldKernel` + `verify` +
`measure` + `handle({type:"export-stl"|"export-3mf"})` work; `bootOcctKernel` +
`handle({type:"export-step"})` works (OCCT boot about 0.2 s, 62 KB STEP for the filleted
box). The package declares `engines.node >= 24`; it runs on Node 22 in every path we use,
so the repo stays on Node 22 as the stack requires, and CI tests the paths (see ADR-018).
**Rejected:** writing a CAD kernel, OpenSCAD (GPL), CadQuery (Python, not browser-runnable).

## ADR-004 — Transactional outbox

**Decision:** every async job is written as a `Job` row plus an `OutboxMessage` row in the
same transaction as the request's other writes (credit reservation, quote, order). A relay
publishes outbox rows to BullMQ with the job ID as the BullMQ job ID, then marks them
published. Duplicate publishes are no-ops; workers are idempotent on job ID.
**Rejected:** enqueueing to Redis inside the request (lost jobs when the request
transaction rolls back, or orphaned rows when Redis is down).

## ADR-005 — Credit model

**Decision:** reserve the maximum cost of a job in one transaction that locks the wallet row
(`SELECT … FOR UPDATE`); commit the actual cost on success; release on failure, cancel, or
expiry. `CreditWallet` has `CHECK (reserved >= 0)` and `CHECK (balance >= reserved)`.
`CreditLedger` is append-only (a trigger rejects UPDATE and DELETE) and has a unique
idempotency key. Balance equals the sum of ledger `delta`s; reservations move `reserved`
and write ledger rows with `delta = 0` and a `reserved_delta`. A fast-check property test
runs 10,000 random sequences in CI.
**Rejected:** charge-on-success only (users can overspend concurrently), floats (forbidden).

## ADR-006 — Live generation provider: Meshy

Documentation read on 2026-10-28:
`https://docs.meshy.ai/llms.txt`, `https://docs.meshy.ai/llms-full.txt` (which concatenates
`/api/text-to-3d`, `/api/webhooks`, `/api/task-lifecycle`, `/api/pricing`,
`/api/asset-retention`).

- **Endpoints:** `POST /openapi/v2/text-to-3d` with `mode: "preview"` and `prompt` (≤ 800
  characters) returns `{ "result": "<task_id>" }`. Refine is the same endpoint with
  `mode: "refine"` and `preview_task_id` of a `SUCCEEDED` preview.
  `GET /openapi/v2/text-to-3d/:id` returns the task object (`id`, `type`, `status`,
  `progress`, `model_urls.{glb,fbx,usdz,obj,mtl,stl}`, `thumbnail_url`, `task_error`,
  `created_at/started_at/finished_at` in Unix ms). Auth is `Authorization: Bearer msy_…`.
- **Statuses:** `PENDING → IN_PROGRESS → SUCCEEDED | FAILED`; `CANCELED` exists (Creative
  Lab only). Final statuses never change. Mapped to ours: `PENDING→QUEUED`,
  `IN_PROGRESS→RUNNING`, others 1:1.
- **Webhooks:** registered in the Meshy developer dashboard (not by API); 5 active per
  account; deliveries are the task object with `progress` 50/100/0. Deliveries **can arrive
  out of order** and **can repeat**; retries up to 4 times for `IN_PROGRESS` and 9 times
  for final statuses; 20 consecutive failed updates can deactivate the webhook.
- **Webhook verification:** the docs describe **no signature**. Therefore the webhook body
  is never trusted: `verifyWebhook` returns false, `parseWebhook` only extracts the task ID,
  and the worker fetches the task with GET before changing state. Dedupe key is
  `id + status`. State only moves forward.
- **Idempotency:** the docs say there is **no idempotency key** and a create should not be
  resent automatically after a timeout or 5xx. Our adapter never retries a create on
  timeout/5xx; it marks the job `RETRYING` with error `PROVIDER_CREATE_UNCERTAIN` and the
  retry path lists recent tasks before creating again.
- **Costs (credits per request, Meshy's own credits):** preview 20 (`meshy-7.1`/`meshy-6`)
  or 5 (`meshy-6-lite`); refine 10 (2K/4K) or 15 (8K); remesh 5; retexture 10. Failed tasks:
  "Credits refunded". Our own credit prices are set independently in seed data.
- **Downloads:** model URLs are signed and expire at the task's `expires_at`; the worker
  downloads results immediately and stores its own copy.
- **Not implemented live:** image-to-3D, retexture, remesh go through the mock provider in
  Release 1; the live adapter throws `NOT_IMPLEMENTED` for them.

**Rejected:** providers without public API documentation; scraping any app.

## ADR-007 — Forge model contract follows partforge's `PartDefinition`

**Decision:** the build prompt sketches `export const schema / build / verify`. The installed
package's documented contract (`docs/AUTHORING-PARTS.md`, `types/part.d.ts`) is a
**default-exported `PartDefinition`**: `meta`, `parameters` (sections of controls),
`defaults`, optional `derive`, `parts.<name>.build(k, p, d)`, `views`, and an optional
`verify` block (`process`, `expect`). The model file follows the package contract, because
the prompt says to confirm signatures against the package and the sketch does not match it.
`forge-kit` derives the flat parameter schema the API needs
(`{ key: { type: number|boolean|enum|text, default, min, max, step, unit, label } }`) from
`parameters` + `defaults`, stores it in `ForgeSource.schema`, and validates and clamps
against it on both server and client.
The DFM profile (`fdm-0.4mm-nozzle`: bed 220×220×250 mm, minimum wall 1.2 mm, overhang
45°) lives in `forge-kit` and is applied on top of the part's own `verify` assertions.
**Rejected:** inventing a second format and translating it (more surface for the AI to get
wrong, and two documents to keep in sync).

## ADR-008 — Forge sandbox

**Browser:** the forge page embeds `apps/forge-runtime` from a **separate origin** in an
`<iframe sandbox="allow-scripts allow-same-origin">`. Because the origin differs from the web
app, `allow-same-origin` grants no access to the app's cookies, storage, or DOM; it is
needed so the iframe can start a module Web Worker from its own origin. The runtime page
never evaluates model code; it only relays messages. The model code is evaluated **only in
the Web Worker** (imported from a `blob:` URL after the static check). The runtime origin
serves static files only and sends `Content-Security-Policy: default-src 'none';
script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self';
img-src 'self' blob: data:; style-src 'self'; frame-ancestors <web origin>`. `connect-src
'self'` is needed for the Manifold WASM file; the runtime origin hosts no API and no user
data, so the worker cannot reach anything but those static files. A rebuild that exceeds
20 s terminates the worker and starts a new one.
**Server:** the authoritative build, verify, thumbnail, and exports run in a child process
started with Node's permission model (`--experimental-permission`, read access limited to
the code directory and `node_modules`, no fs write, no child processes, no worker threads,
no native addons), `--max-old-space-size` as the memory cap, network globals removed before
the model loads, `net`/`tls`/`dns` connect functions replaced with throwing stubs, and a
SIGKILL at 20 s. Production runs the forge-build worker container with no egress.
**Static check (both sides):** an AST walk (acorn) rejects any import outside `partforge`
and its subpaths, dynamic `import()`, `require`, `eval`, `Function`, `process`,
`globalThis`, `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `__proto__`, and
`constructor` member access.
**Rejected:** Node `vm` contexts (not a security boundary), running model code in the
iframe's main thread (spec asks for the worker), an opaque-origin iframe (cannot start a
module worker from a URL).

## ADR-009 — Storage drivers

**Decision:** `STORAGE_DRIVER=s3` (MinIO in compose, S3 in production) and `fs` (local disk +
HMAC-signed URLs served by the API with the same 5-minute GET / 15-minute PUT expiries).
Default is `fs` so `pnpm dev` and CI need no object store.
**Rejected:** requiring MinIO for every test run.

## ADR-010 — Estimate quotes and ordering

**Decision:** estimate quotes cannot be ordered (`ESTIMATE_ORDERS=block`, the default; the
checkout returns `409 ESTIMATE_NOT_ORDERABLE`). `ESTIMATE_ORDERS=allow-dev` exists for local
demos and the E2E suite (J3, J6) and is refused at boot when `NODE_ENV=production`.
**Rejected:** a fake "real" slicer result (misleading), blocking the whole checkout path in
development (the order and payment code would ship untested).

## ADR-011 — Zod 4 and generated OpenAPI

**Decision:** API contracts are Zod 4 schemas in `packages/shared`. A route registry pairs
each route with its schemas, and `pnpm openapi` writes `openapi.yaml` using Zod's built-in
JSON Schema conversion. A test fails if the committed `openapi.yaml` is stale.
**Rejected:** hand-written OpenAPI (drifts), third-party Zod-to-OpenAPI bridges (lag behind
Zod 4).

## ADR-012 — UI components

**Decision:** shadcn/ui is a copy-in pattern, not a dependency. `packages/ui` holds a small
set of components written in that pattern (button, input, select, dialog with focus trap,
badge, card, toast) on Tailwind v4 tokens restyled to the brand.
**Rejected:** a full component library (more weight than the screens need).

## ADR-013 — Money representation

**Decision:** money is integer minor units (`Int` in the database, `number` in TypeScript
within the safe-integer range). Pricing intermediates use BigInt in micro-minor units, and
`round_half_up` is applied exactly where the formula says. Rates are integers: material
cost in minor units per kilogram, machine rate in minor units per hour, margin and
discounts in basis points. Credits are integers.
**Rejected:** decimals libraries (an extra dependency for arithmetic BigInt already covers),
floats (forbidden).

## ADR-014 — Identifiers

**Decision:** database IDs are UUIDv7 (`uuid` columns, generated in the app). The API
renders them with type prefixes (`usr_`, `ast_`, `frg_`, `job_`, `prt_`, `qte_`, `ord_`,
`key_`, `whk_`, plus `ver_`, `fil_`, `upl_`, `crt_`, `cit_`, `adr_`, `evt_`) as
`<prefix><uuid without dashes>`. Parsing rejects a wrong prefix with `404`.

## ADR-015 — Mock payments mirror Stripe's webhook contract

**Decision:** `PAYMENTS_MODE=mock` creates a local checkout page that, when the buyer clicks
pay, posts a `checkout.session.completed` event to `/internal/stripe/webhook`, signed with
the same `Stripe-Signature: t=…,v1=HMAC-SHA256(t.payload)` scheme and a local secret. The
webhook handler, dedupe, and amount/currency checks are therefore identical in both modes.
`stripe-test` uses the Stripe SDK and refuses to boot without `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`.

## ADR-016 — Tax

**Decision:** Stripe Tax is not enabled in Release 1 (no account). Quotes and checkout show
"tax calculated where applicable" and the tax line is 0. The gap is a launch blocker for
selling into jurisdictions that require collection.

## ADR-017 — Email

**Decision:** nodemailer over SMTP to Mailpit in compose (`MAIL_DRIVER=smtp`); `log` prints
emails (default when no SMTP is configured); `memory` is for tests. Emails are sent by the
`email` worker from outbox messages, never inline in requests.

## ADR-018 — Runtime versions

Node 22 (stack requirement) even though partforge declares Node ≥ 24 (ADR-003). pnpm 10,
Turborepo 2, TypeScript 5.9 strict with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, Vitest 3, ESLint 9 flat config, Playwright using the Chromium
build installed on the machine.

---

## Open questions

Each has the option chosen for now.

1. **Trademark clearance for "Shapewright".** Chosen: use it internally; clear before launch.
2. **Meshy webhook authenticity.** No signature is documented. Chosen: never trust the body;
   fetch the task by ID. Revisit if Meshy publishes a signing scheme.
3. **Estimate-mode ordering.** Chosen: blocked in production, `allow-dev` for demos (ADR-010).
   Needs a product decision on whether ops-reviewed manual quotes may be ordered before a
   real slicer exists.
4. **Tax.** Chosen: no tax collection until Stripe Tax is configured (ADR-016).
5. **LGPL components in the forge stack.** partforge's STEP path loads OpenCASCADE compiled
   to WASM (`replicad-opencascadejs`, which declares MIT, while OpenCASCADE itself is
   LGPL-2.1 with an exception). Chosen: STEP export runs only on the server worker, which
   ships the unmodified WASM; counsel to confirm notice and relinking obligations
   (LICENSE-AUDIT.md).

## ADR-019 — Credit property tests: pure core plus database check

**Decision:** the wallet rules live in a pure function (`packages/shared/src/credits.ts`)
that the database service calls after locking the wallet row. The fast-check property
test runs 10,000 random sequences of grant, reserve, commit, release, reservation expiry,
grant expiry, and debit against the pure core (`FAST_CHECK_RUNS`, 10,000 by default and in
CI). A second property test drives the real database service (25 sequences by default,
`FAST_CHECK_DB_RUNS`) so the CHECK constraints, the ledger trigger, and the service agree.
**Why:** 10,000 database-backed sequences take minutes; the pure core is where the logic is.
**Grants:** credits are held in `CreditGrant` buckets so monthly plan credits can expire at
period end while packs never expire. Spending takes the soonest-expiring bucket first.
Expiry only takes credits not held by open reservations; the rest expire on a later sweep.

## ADR-020 — Sessions, CSRF, anonymous visitors

**Decision:** sessions are random 32-byte tokens in an `HttpOnly`, `SameSite=Lax` cookie;
the database stores SHA-256 hashes. Mutating requests that carry cookies must send an
`Origin` equal to `WEB_ORIGIN` or `API_ORIGIN` (`403 ORIGIN_MISMATCH`). API keys skip the
check (no ambient credentials). Anonymous visitors get a random `sw_anon` cookie; rows
store its hash, and sign-in claims them. Magic-link emails go through the outbox, so the
token is present in the outbox payload until the email worker sends it (accepted risk;
the outbox is not exposed by any route).
**Rejected:** CSRF tokens (Origin checking covers fetch-based clients with less state).
