# OPUS BUILD PROMPT — "Generate → Print" platform (original product, parity with the AI 3D + print-on-demand category)

Paste everything below the line into Opus as one message. Work from an empty repository.

---

## 0. Role and operating rules

You are a principal full-stack engineer and product architect. You will build a commercial web platform with two linked products, sharing one account, one credit wallet, one asset library, and one admin console:

- **Studio** — AI 3D generation (text → 3D, image → 3D, multi-image → 3D), texture generation on existing meshes (retexture), mesh reduction (remesh/decimate), UV unwrap, format conversion, library, public REST API with keys, webhooks, and credit billing.
- **Print** — 3D print fulfilment with two entry points: (a) **Order a print from a listing**: any public model in the library can be marked "printable" by its creator, and a buyer orders a physical copy; the platform routes the order to the nearest qualified print partner. (b) **Upload and quote**: a buyer uploads their own STL/OBJ/3MF, gets an accurate automatic quote, and orders.

Rules you must follow for the whole build:

1. **Original product.** Choose your own name, logo, palette, copy, and UI. Do not reuse any name, logo, screenshot, icon, copy, layout, or code from Meshy, PrintPal, Craftcloud, Xometry, Formlabs, or any other product. Use open-licensed UI primitives (Radix, shadcn/ui) and icons (Lucide, ISC). Produce `LICENSE-AUDIT.md` listing every direct dependency and its license. No GPL/AGPL code in the web app or in anything linked into it.
2. **Official APIs and public docs only.** Do not scrape, reverse-engineer, or automate any third-party site or app. Before writing each provider adapter, read that provider's current official docs and put the URL and retrieval date in the adapter's header comment. If a doc is ambiguous, implement behind an interface with a mock and write the open question to `docs/decisions.md`. Never guess an endpoint, field name, or signature.
3. **Money and physical orders are the highest-risk surface.** Prices, tax, shipping, refunds, and credit movements are computed on the server, are idempotent, and are audited. The client never supplies an amount that the server trusts.
4. **Do not stop to ask questions.** For any ambiguity, choose the most defensible option, record it in `docs/decisions.md` with the alternatives you rejected, and continue. Only stop for a missing secret, and even then build the mock path first.
5. **Scope discipline.** You will build in vertical slices (Section 15). Each slice ships working software with tests. Do not start a slice until the previous one is green.

---

## 1. Verified competitive facts (checked 2026-10-21 — build against these, do not re-derive from memory)

Use this section as the reference for "how the category works." Items marked **UNVERIFIED** are not confirmed and must be treated as open questions, not requirements.

### 1.1 Meshy (AI 3D generator; the Studio benchmark)

Source: official docs at docs.meshy.ai (Text-to-3D API page, Webhooks page, API pricing page, webapp pricing page).

- **Products:** text-to-3D, image-to-3D, multi-image-to-3D, retexturing, remeshing, UV unwrap, auto-rigging, animation, format convert, resize. Output formats include GLB, plus OBJ, FBX, STL, USDZ per the API. Exports and textures are downloadable as files returned by the task.
- **Two-stage text-to-3D:** a **preview** task (mode `preview`) produces an untextured mesh so the user can check the shape. A **refine** task (mode `refine`) takes the successful preview's **task ID** and adds texture. Setting `enable_pbr` on refine adds metallic, roughness, and normal maps. Refine is only valid when the preview has succeeded. **Build this exact two-stage model.**
- **Task model:** every operation is a task. Results are read with a GET on the task ID. Status values include `IN_PROGRESS` and `SUCCEEDED` and `FAILED`/`CANCELED`. Progress is 0–100.
- **Webhooks (confirmed):** configured in the developer dashboard by creating a Webhook with an `https://` Payload URL, marked Active. Limits: 5 active and 10 total per account. Meshy sends a `POST` whose body is the task object (same shape as GET). Progress in the payload is 50 during `IN_PROGRESS`, 100 on success, 0 on failure or cancel. Any response ≥400 or no response counts as failure. Retries: up to 4 for `IN_PROGRESS` updates and up to 9 for final statuses. After 20 consecutive failed updates the webhook can be deactivated. **Deliveries can arrive out of order and can repeat.** A final status can arrive with no `IN_PROGRESS` event. If a final event is missing after about 2× the task's typical duration, poll the GET endpoint. Respond quickly and process asynchronously.
- **Signature verification:** UNVERIFIED in the page we read. Treat as open; if the docs confirm a signature header, verify it; until then, use a per-webhook random path token plus a fetch-back of the task via GET before trusting the status.
- **Credits (API, per request, current table, mesh only unless noted):** Text-to-3D preview 20 (on the flagship models) / 5 (on the lite/older models). Image-to-3D 20 / 5. Image-to-3D with 2K or 4K textures +10 (30 / 15). Multi-image-to-3D mesh 20 / 5, with the same texture surcharges. Ultra geometry surcharge +5 on the flagship model for 2K/4K geometry. Text-to-3D refine 10 (2K/4K) or 15 (8K). Retexture 10 (2K/4K) or 15 (8K). Auto-rig 5. Animation 3 per action (up to 10 actions). Post-processing: remesh 5, UV unwrap 5, convert 1, resize 1.
- **Credits (webapp, different table):** monthly credits reset on the 1st at 00:00 UTC; purchased/permanent credits do not expire; **failed generations are not charged; canceled tasks are refunded.** Free-plan outputs are CC BY 4.0; paid plans include commercial rights. The webapp and API tables disagree for some operations. Treat the API table as authoritative for API customers and keep your own price table in config.
- **Model versions are first-class:** the API exposes named model versions with different costs and capabilities. Your model catalog must be data, not code (see 4.4).
- **Hardware fulfilment:** Meshy announced a fulfilment integration with Formlabs' on-demand print service (April 2026) and an entry point inside FlashForge's desktop slicer app (May 2026). Pattern: generation platform hands a model to a manufacturing partner via partner integration. **Build your print network as a partner adapter interface; do not assume you have any partner.**

### 1.2 PrintPal (creator-model marketplace with local print fulfilment; the Print benchmark)

Source: printpal.io/text-to-cad-ai and blog.printpal.io "Getting Started with PrintPal."

- Users describe a concept and receive a 3D model, which can be downloaded (STL, OBJ, GLB, "and more") or sent to "our network of print partners."
- **Ordering flow (from the getting-started guide):** the "Order Print" button appears on a model's page **only where the creator has enabled printing**. The buyer enters shipping details, picks a material (examples given: PLA, ASA) and any customizations the creator offers. PrintPal "finds the printer nearest to you and delivers the model."
- Some features are gated to paid plans (e.g., articulated/flexi model creation is Pro and Studio only). A free tier exists with no card required.
- **UNVERIFIED:** pricing and shipping display, payment flow, how the partner is selected (owned vs. third-party), creator revenue share, and print-quality guarantees. The getting-started page does not cover them. Do not invent them; define them in `docs/pricing.md` as our own decisions.

**Implication:** PrintPal's verified model is "creator-enabled listing + nearest-partner print + ship to door." It is not an STL instant-quote shop. Our Print product therefore needs **both** entry points in Section 8.

### 1.3 Print-quote marketplaces (Craftcloud, Xometry and similar)

Source: All3DP comparison coverage; Engineering.com hands-on review. Note All3DP has a commercial tie to Craftcloud; treat its claims as secondary.

- **Craftcloud:** instant quote with **no registration required**; the price breakdown updates live as the user changes material and finish; a large partner network (reported 150+ manufacturers, 140+ materials); no minimum order value; expanding into CNC and sheet metal.
- **Xometry:** instant quotes filterable by process, material, and lead time; **sign-up required** to quote; an always-visible 3D viewer that gives design-for-manufacturing feedback on the model.
- **Implication for us:** the upload-and-quote path must work **before sign-up** (quote first, account at checkout). The viewer must show manufacturability feedback, not just rotation.

### 1.4 AI print pipeline trends (for product context)

- Generation platforms are integrating directly with print hardware and print-on-demand networks (Meshy + Formlabs; Meshy + FlashForge; Creative Fabrica's "watertight printable mesh" generator). The differentiator is **print-ready output**: watertight, manifold, right scale, sized to a build plate. Your generator must run the same printability check on every generated mesh (Section 6.5).

---

## 2. What the platform must do, in one page

1. A user signs in (magic link or Google) and gets a free credit grant.
2. **Studio:** they type a prompt or upload images, run a **preview** (cheap, geometry only), inspect it in a 3D viewer, then **refine** it (textured, costs more). They can also retexture an existing mesh, remesh it, and export it as GLB, OBJ, STL, FBX, or USDZ, subject to plan.
3. Every generated model lands in a library. Each model has a visibility setting and a license. Public models can be listed in the Shop.
4. **Print (listing path):** any public model whose creator enabled printing shows an "Order print" button. The buyer picks material, color, and quantity, sees a price, pays, and the order is routed to the nearest qualified print partner. The buyer receives the part, and the creator earns a configurable share.
5. **Print (upload path):** a buyer uploads a model without signing up, gets an automatic quote from a real slicer run, configures it, signs up at checkout, pays, and gets the part shipped.
6. An operator runs the partner queue, marks QC pass/fail, handles refunds and reprints, and audits everything.
7. Developers create API keys and webhook endpoints and call the Studio API. Usage is metered in credits.

---

## 3. Repository and stack (decide, justify in ADRs, then lock)

Monorepo with pnpm workspaces and Turborepo, Node 22 LTS, TypeScript strict (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes).

```
apps/
  web/            Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui (customized to our brand)
  api/            Fastify 5 REST API; mounts public developer API under /v1 and internal webhook receivers under /internal
  worker/         Node 22 BullMQ consumers: generation, asset-import, export, quote, order-events, email, reaper
  mesh-service/   Python 3.12 FastAPI: analyze, repair, decimate, orient, LOD, convert, slice (PrusaSlicer CLI)
packages/
  db/             Prisma 6 schema, migrations, seeds
  shared/         Zod contracts (single source of truth), error codes, enums, state machines, money utils
  pricing/        Pure pricing engine + versioned config JSON + golden tests
  providers/      ModelProvider interface, adapters (mock; one real adapter), PrintPartner interface, carrier interface
  ui/             Design tokens and components
  config/         Shared tsconfig, eslint (flat), prettier, env validation
infra/
  docker-compose.yml   postgres 16, redis 7, minio, mailpit, stripe-cli, mesh-service, prusa-slicer image
  dashboards/          Grafana JSON
  runbooks/
docs/
```

Why Fastify for the API and not Next.js route handlers: long-lived SSE, webhook receivers with raw-body handling, and worker coordination are simpler and more testable in a dedicated process. Record this as ADR-001.

Why Python for mesh work: trimesh, manifold3d, and mature slicer tooling are Python-first. Record as ADR-002. The mesh service is internal only.

### Local development with zero external credentials

`pnpm dev` must start everything. Feature flags, all in env:

- `PROVIDER_MODE=mock|live`
- `SLICER_MODE=real|estimate` (estimate = deterministic estimator, visibly labeled "ESTIMATE" in UI)
- `PAYMENTS_MODE=mock|stripe-test`
- `PARTNER_MODE=mock|live`
- `EMAIL_MODE=mailpit|provider`
- `STORAGE=minio|s3`

A `.env.example` documents every variable. A Zod env schema in `packages/config` refuses to boot with a readable list of missing keys.

---

## 4. Data model (write it as Prisma schema and migrations; all IDs are UUIDv7 with prefixes in the API: `usr_`, `ast_`, `job_`, `prt_`, `qte_`, `ord_`, `key_`, `whk_`)

### 4.1 Identity and access
- `User` (id, email citext unique, name, role `USER|ADMIN|OPS|SUPPORT`, status `ACTIVE|SUSPENDED|PENDING_DELETION`, email_verified_at, locale, timezone, terms_version, privacy_version, created_at, deleted_at)
- `Account` (OAuth links; unique on provider + provider_account_id)
- `Session` (id, user_id, token_hash, expires_at, last_seen_at, ip_hash, ua_hash)
- `MagicLink` (token_hash, user_id, expires_at, consumed_at) — single use, 15 min
- `ApiKey` (id, owner_id, name, prefix, hash, scopes text[], last_used_at, revoked_at)
- `WebhookEndpoint` (id, owner_id, url, secret_hash, events text[], active, failure_count), `WebhookDelivery` (id, endpoint_id, event_id, attempt, status, response_code, next_attempt_at, payload_ref)

### 4.2 Money and credits
- `CreditWallet` (owner_id unique, balance, reserved) — `CHECK (reserved >= 0 AND balance >= reserved)`. Available = balance − reserved.
- `CreditLedger` (append-only; wallet_id, delta, kind `GRANT|PURCHASE|RESERVE|COMMIT|RELEASE|REFUND|ADJUSTMENT|EXPIRY|PAYOUT_OFFSET`, reference_type, reference_id, idempotency_key unique, balance_after, reserved_after, actor_id, reason, created_at). A database trigger rejects UPDATE and DELETE.
- `Plan` (code `FREE|CREATOR|STUDIO`, monthly_credits, price_minor, currency, stripe_price_id, features jsonb, active)
- `Subscription` (owner_id, plan_id, stripe_subscription_id unique, status, period_start, period_end, cancel_at_period_end)
- `CreditPack` (code, credits, price_minor, stripe_price_id, active)
- `PromoCode` (code unique, kind `PERCENT|FIXED_MINOR|CREDITS`, value, max_redemptions, redeemed_count, expires_at, applies_to `ALL|PRINT|CREDITS`)
- `Payment` (stripe_payment_intent_id unique, amount_minor, currency, status, refunded_minor)
- `Payout` (creator_id, order_item_id, amount_minor, status `PENDING|PAID|REVERSED`, stripe_transfer_id unique) — for listing-path creator share
- `Invoice` (stripe_invoice_id unique, number, total_minor, tax_minor, pdf_key)

### 4.3 Studio
- `Job` (id, owner_id, kind, status, progress, attempt, max_attempts, parent_job_id, input_json, output_json, error_code, error_message, provider, provider_task_id, provider_model, idempotency_key, reserved_credits, committed_credits, created_at, started_at, finished_at, next_run_at, locked_by, locked_at)
- `JobEvent` (append-only; job_id, from_status, to_status, detail, created_at)
- `Asset` (id, owner_id, kind `GENERATED|UPLOADED|PRINT_PART|TEMPLATE`, title, prompt, negative_prompt, style, source_job_id, parent_asset_id, visibility `PRIVATE|UNLISTED|PUBLIC`, license `PRIVATE|CC_BY|CC_BY_NC|ALL_RIGHTS_RESERVED`, print_enabled bool, print_settings_default jsonb, tags text[], status, deleted_at, purge_after)
- `AssetVersion` (asset_id, version_no unique per asset, stage `PREVIEW|REFINED|RETEXTURED|REMESHED|UPLOAD|CONVERTED`, provider, provider_model, provider_task_id, triangles, vertices, bbox_mm jsonb, volume_mm3, surface_area_mm2, is_watertight, is_manifold, has_uv, texture_count, analysis jsonb)
- `AssetFile` (version_id, role `MESH|TEXTURE_BASE|TEXTURE_NORMAL|TEXTURE_ROUGHNESS|TEXTURE_METALLIC|THUMBNAIL|LOD_PREVIEW|QC_PHOTO|PRINT_SOURCE`, format, storage_key, bytes, sha256, mime, expires_at)
- `Collection`, `CollectionItem` (position), `ShopListing` (asset_id unique, status `DRAFT|LIVE|PAUSED|REMOVED`, price_policy, creator_share_bps, approved_by, approved_at)

### 4.4 Model catalog (data, not code)
- `GenerationModel` (code, provider, provider_model_id, capabilities jsonb: text3d, image3d, multiImage, refine, retexture, remesh, rig, animate, maxImages, outputs[], maxTextureRes, active, cost_table_version)

### 4.5 Print
- `Material` (code `PLA|PETG|ASA|ABS|TPU|RESIN_STANDARD|NYLON_PA12`, technology `FDM|SLA|SLS`, density_g_cm3, colors jsonb, active)
- `Finish` (code `AS_PRINTED|SANDED|VAPOR_SMOOTHED|PAINTED`, technology, surcharge fields)
- `PrintPartner` (id, name, technology list, country, active, adapter_key, sla_hours, contact_ref)
- `PartnerPrinter` (partner_id, name, technology, build_volume_mm, materials text[], state `IDLE|BUSY|MAINTENANCE|OFFLINE`, location: lat, lon, ship_from_country, queued_seconds_estimate, vendor_ref)
- `PrintPart` (id, owner_id, asset_version_id nullable, upload_id nullable, status `UPLOADED|SCANNING|ANALYZING|NEEDS_REPAIR|REPAIRING|READY|REJECTED`, validation_report jsonb, bbox_mm, volume_mm3, surface_area_mm2, orientation_quat, scale_pct, settings jsonb, slice_result jsonb, expires_at for anonymous parts)
- `Quote` (id, owner_id nullable (anonymous allowed, claimed on login), lines jsonb, subtotal_minor, shipping_minor, tax_minor, discount_minor, total_minor, currency, pricing_version, inputs_hash, status `ISSUED|EXPIRED|CONSUMED|SUPERSEDED`, expires_at)
- `Cart`, `CartItem` (part_id or listing_id, quantity, quote_id)
- `Address` (owner_id, fields, country ISO-3166 alpha-2, validated_at)
- `Order` (id, buyer_id, source `LISTING|UPLOAD`, status (see Section 7), shipping_address_snapshot jsonb, subtotal_minor, shipping_minor, tax_minor, discount_minor, total_minor, currency, pricing_version, stripe_checkout_session_id unique, placed_at, paid_at, cancelled_at)
- `OrderItem` (order_id, asset_version_id or print_part_id snapshot, material, color, finish, settings snapshot, quantity, unit_price_minor, partner_id, partner_printer_id, status (Section 7), creator_id nullable, creator_share_minor)
- `OrderEvent` (append-only; order_id, order_item_id nullable, from_status, to_status, actor_type `BUYER|CREATOR|SYSTEM|OPS|PARTNER|CARRIER|STRIPE`, actor_id, reason, payload jsonb, created_at)
- `QcReport` (order_item_id, result `PASS|FAIL|REWORK`, notes, photo_file_ids[], inspector_id, created_at)
- `Shipment` (order_id, carrier, service, tracking_number, label_key, weight_g, dims_mm, shipped_at, delivered_at)
- `Refund` (order_id, amount_minor, reason, stripe_refund_id unique, status, approved_by, approval_required bool)
- `ProblemReport` (order_id, buyer_id, category, body, status)

### 4.6 Platform
- `AuditLog` (append-only; actor_id, actor_role, action, target_type, target_id, before jsonb, after jsonb, reason, ip_hash, created_at)
- `ProviderEventRaw` (provider, event_key unique, payload jsonb, received_at, processed_at)
- `StripeEventRaw` (stripe_event_id unique, type, payload, received_at, processed_at)
- `OutboxMessage` (id, topic, payload, created_at, published_at)
- `FeatureFlag` (key, value jsonb, updated_by)

### 4.7 Required constraints and indexes (enforce in migrations)
- Wallet CHECKs above. Ledger immutability trigger. Ledger idempotency_key unique.
- `Job` unique (owner_id, idempotency_key). Partial index on `Job(status, next_run_at)` where status in `QUEUED, RETRYING`.
- Trigram GIN on `Asset.title` and `Asset.prompt`.
- `Order(buyer_id, placed_at desc)`, `Asset(owner_id, created_at desc)`, `Asset(visibility, status)` for the Shop.
- Every repository method takes an owner scope. A test fails the build if any repository query lacks one.

---

## 5. Architecture and the async job model

### 5.1 Request path
Browser → Next.js (SSR and BFF only) → Fastify API → Postgres/Redis/object storage. The browser never talks to the database or object storage except via presigned URLs issued by the API.

Auth: Auth.js in `apps/web` issues an `HttpOnly; Secure; SameSite=Lax` session cookie backed by the shared `Session` table. Developer API uses `Authorization: Bearer <key>`; keys are shown once, stored as SHA-256 of key + server pepper, and carry scopes: `studio:generate`, `studio:read`, `studio:write`, `print:quote`, `print:order`, `billing:read`, `webhooks:manage`. Scope failures return `403 INSUFFICIENT_SCOPE`.

CSRF: double-submit token on cookie-authenticated mutating requests. API-key requests are exempt.

### 5.2 Transactional outbox and jobs
- Any long operation is a `Job`. The API writes `Job` + `OutboxMessage` in one transaction. A relay publishes outbox rows to BullMQ and marks them published. A crash between DB commit and publish is recovered by the relay on restart.
- Workers claim a job with `UPDATE ... WHERE status='QUEUED' RETURNING` (or `SELECT ... FOR UPDATE SKIP LOCKED`), set `locked_by` and `locked_at`, and heartbeat every 30 s.
- **Reaper** every 60 s re-queues `RUNNING` jobs whose heartbeat is older than 5 min.
- Retries: exponential backoff with full jitter, base 5 s, cap 5 min, max 5 attempts for retryable errors (provider 5xx, timeout, rate limit, partner timeout). Non-retryable errors (validation, moderation, insufficient credits, unsupported model) fail immediately.
- **Progress delivery:** Server-Sent Events at `GET /v1/jobs/:id/events` with `Last-Event-ID` resume; polling fallback at `GET /v1/jobs/:id` every 2 s with `ETag`.
- `Idempotency-Key` header is required on every POST that creates a job, order, or charge. Replays inside 24 h return the original response with `Idempotent-Replayed: true`. A replay with a different body returns `409 IDEMPOTENCY_CONFLICT`.

### 5.3 Provider integration (generation)
Generation steps for a text-to-3D preview:

1. Validate input (prompt 1–600 chars, negative prompt ≤ 600, enum style and topology, polycount target within model limits).
2. Moderate the prompt through a local classifier plus a banned-term list. Document the choice; provider moderation is used if the provider offers an endpoint.
3. Look up the `GenerationModel` and its cost from the versioned cost table. Compute the reservation as the **maximum** cost for the chosen options.
4. In one transaction: check available credits (`balance − reserved ≥ cost`), write a `RESERVE` ledger row, increment `reserved`, create `Job` (status `QUEUED`) and outbox row. If insufficient, return `402 INSUFFICIENT_CREDITS` with `required` and `available`.
5. Worker calls `ModelProvider.createTask`, stores `provider_task_id`, and sets status `RUNNING`.
6. Completion is detected by **provider webhook** when available (verify, store raw event in `ProviderEventRaw` keyed by provider event key, then process idempotently) **or by polling** (every 5 s, backing off to 15 s after 2 min, capped at the provider's documented task lifetime).
7. On `SUCCEEDED`: fetch result files, verify size and content-type, compute sha256, stream to `assets/{owner}/{asset}/{version}/...` in object storage, create `Asset`/`AssetVersion`/`AssetFile` rows, enqueue `LOD` and `ANALYZE`.
8. On `SUCCEEDED` with usable output: commit the reservation (`COMMIT` ledger row, decrement `reserved` and `balance`). On `FAILED` or `CANCELED`: release (`RELEASE` ledger row, decrement `reserved`). Failed generations are never charged.
9. Emit `job.succeeded` or `job.failed` through SSE, email (if opted in), and the developer webhook queue.

**Refine** creates a child job with `parent_job_id`, reusing the preview's provider task ID as the provider requires. Preview must be `SUCCEEDED`; the child reservation uses the refine cost.

**Image-to-3D:** upload → quarantine → type and size scan → background removal (worker step; provider-provided if offered, otherwise a local model with a license check) → normalize to a square PNG at a documented resolution → createTask.

**Retexture and remesh:** input must be an `AssetVersion` the user owns or a fresh upload that has passed analysis. Remesh and decimate run in `mesh-service` first when the provider does not support them.

### 5.4 Provider adapter contract (packages/providers)

```ts
export interface ModelProvider {
  readonly key: string;                       // e.g. "mock", "provider-a"
  capabilities(modelCode: string): Capabilities;
  createTask(input: ProviderInput, ctx: { idempotencyKey: string }): Promise<{ providerTaskId: string }>;
  getTask(providerTaskId: string): Promise<NormalizedTask>;   // QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELED, progress 0–100
  cancelTask(providerTaskId: string): Promise<void>;
  parseWebhook(headers: Headers, rawBody: Buffer): { providerEventKey: string; task: NormalizedTask } | null;
  verifyWebhook(headers: Headers, rawBody: Buffer): boolean;   // false → 401, no processing
  mapError(raw: unknown): InternalErrorCode;
}
```

Required implementations:
- **MockProvider** (deterministic): derives output from a hash of the prompt, returns one of five bundled test meshes you procedurally generate with trimesh (no third-party models), simulates latency 8–25 s, and accepts a `failureRate` setting for tests. It supports out-of-order and duplicate webhook delivery simulation so the webhook handling is tested under the same conditions as the real provider.
- **One live adapter**: pick one provider whose official docs you can read and implement it against current docs. Record the chosen provider's rules in `docs/decisions.md`: webhook limits, retry behavior, duplicate/out-of-order handling, and signature method. If you cannot confirm the signature method, the adapter must use the fetch-back verification in 5.5 and must not trust webhook bodies.
- Circuit breaker per provider: open after 5 failures in 60 s; half-open after 30 s.
- Each adapter reports provider-side cost per task so margin can be computed.

### 5.5 Webhook receiver rules (applies to every inbound webhook: provider, Stripe, carrier, partner)
1. Respond `202` within 2 s. Store the raw body first.
2. Verify the signature (or fetch-back for providers without verifiable signatures).
3. Dedupe on the provider's event key. Duplicates no-op.
4. Process out of order safely: a status update only applies if it moves the state machine forward. A late `IN_PROGRESS` never overwrites a final state.
5. If a final event is missing for longer than 2× the task's typical duration, a scheduled reconciler fetches the task.

---

## 6. Studio features (detailed)

### 6.1 Text-to-3D studio
- Left: prompt textarea (600-char counter), negative prompt (collapsed), style chips (Realistic, Stylized, Low-poly, Sculpt, Toy), topology (Quad / Triangle), polycount target slider bound to the model's limits, model picker (from `GenerationModel` where `active`, with capability badges), and a live cost panel showing preview cost and refine cost before submit.
- Right: job cards with stage badge (Preview / Refine), progress bar, ETA from the median of the last 50 successful jobs of the same model and stage, and actions (Cancel, Refine, Retexture, Export, Print).
- A preview card is only enabled for Refine when `status=SUCCEEDED`. Refine shows the reserved cost before confirmation.
- Failed cards show a plain-language reason from `error_code` and a single Retry button. Retry creates a new job; it does not reuse the old reservation.
- Cancel before `RUNNING` releases the reservation immediately. Cancel during `RUNNING` calls `cancelTask` and releases on confirmed cancel.

### 6.2 Image-to-3D and multi-image studio
- Drop zone for 1–4 images (single) or 2–8 labeled views (multi: Front, Back, Left, Right, Top, Other), JPG/PNG/WEBP, ≤ 20 MB each, minimum 512 px on the short side.
- Crop tool with a square output. Background-removal toggle, with a before/after preview.
- "Single object?" check: the platform warns (does not block) when the background-removed image has more than one large connected region.
- Symmetry toggle, shown only if the chosen model supports it.
- Validation runs client-side for immediate feedback and server-side as the source of truth.

### 6.3 Job detail
- Timeline from `JobEvent`, input echo (prompt, images, options), output viewer, file list with sizes, credit breakdown (reserved, committed, released), actions: Regenerate with same inputs, Refine, Retexture, Remesh, Export, Send to print, Delete.

### 6.4 Shared 3D viewer (the most important UI component)
- Three.js loaded via dynamic import, not in the initial bundle. Orbit, pan, zoom, keyboard arrows for orbit, `F` to frame, `R` to reset.
- Lighting presets: Studio, Daylight, Dark. Wireframe toggle. Grid toggle with real-world scale (mm or cm) and a bounding-box readout in mm.
- Screenshot to PNG. Fullscreen.
- Performance: the viewer loads `LOD_PREVIEW` (≤ 50k triangles, generated by mesh-service) first, then the full mesh on user request. It must hold 30 fps on a 500k-triangle full mesh on a mid-range laptop when the full mesh is loaded, with draw-call count below 200.
- **Print overlay:** when the viewer is used for print, it additionally shows a build-plate footprint for the selected printer profile, overhang faces (> 45° from the build plate in the chosen orientation) tinted, and a scale ruler. This is the manufacturability feedback Xometry-style viewers provide. Build it in one shared component with a prop-driven overlay layer.

### 6.5 Printability check on every generated and uploaded mesh
Run `mesh-service /analyze` on every `AssetVersion`. Store the report and show a plain-language summary: watertight, manifold, degenerate faces, flipped normals, self-intersections, units guess, bounding box, and "printable at current scale" yes/no. Generated meshes that fail watertightness get a one-click "Repair for printing" action that calls `/repair` and creates a new `AssetVersion` with stage `REMESHED` (never overwrite).

### 6.6 Retexture
Pick a mesh from the library (must have UV, or the UI offers UV unwrap at 5 credits first). Prompt or reference image. Outputs: base color, roughness, metallic, normal. Resolution: 1K, 2K, 4K, 8K per model capability. Cost shown before run.

### 6.7 Remesh and decimate
Target face count (slider with live estimate), preserve-UV toggle, preserve-boundary toggle. Output mesh previewed side by side with the input, with triangle counts for both. Runs in `mesh-service`, not a third-party provider, unless the provider's remesh is chosen by the user as a model option.

### 6.8 Export dialog
Formats by plan: GLB (all plans), OBJ+MTL zip, STL, FBX (only where the provider or the converter supports it), USDZ (optional). Texture resolution options per model. Units: mm, cm, m, inch. Up axis: Y or Z. Shows estimated file size. Exports are async `export.convert` jobs with a short-lived download URL (5 min). Export files expire from storage after 7 days.

### 6.9 Library
- Grid and list views. Filters: kind (generated, uploaded, print part), status, date range, tags, visibility, has-print-enabled.
- Search over title, prompt, and filename using the trigram index.
- Bulk actions: download ZIP, delete, change visibility, add to collection, enable printing.
- Collections with drag-to-reorder (keyboard reorder as well: Alt+Arrow).
- Each asset has a detail page: viewer, versions list, files, license, print status.

### 6.10 Licensing and public content
- Every public asset has a license. Free-plan outputs are licensed CC BY 4.0 by default (this matches the published Meshy-style free-tier convention). Paid-plan outputs default to `ALL_RIGHTS_RESERVED` owned by the user, with commercial use allowed. Record the exact policy in `docs/decisions.md` and show it in Terms.
- Uploads require the user to confirm they own rights. Public listing requires a license selection.
- DMCA/takedown: a form, an admin action that hides the asset, notifies the owner, and logs the action. Counter-notice path documented.

---

## 7. Print product (detailed)

### 7.1 Two entry points

**A. Listing path (creator-enabled, PrintPal-style):**
1. A creator opens an asset, toggles "Allow printing," and sets: default material list, color options, finish options, quantity range, and creator share (default 10%, configurable within an admin-set range).
2. Asset must be `PUBLIC` or `UNLISTED`, have `analysis.printable=true` at the chosen scale, and have passed the `ShopListing` review by a human when first enabled (moderation gate).
3. A buyer sees "Order print" on the asset page, picks material, color, finish, quantity, and shipping address, sees a price, and checks out.
4. The order is routed to the nearest qualified partner printer (Section 7.4).

**B. Upload path (Craftcloud/Xometry-style):**
1. A visitor, signed out, uploads STL/OBJ/3MF (≤ 150 MB, up to 10 parts per cart). The upload is held as an anonymous `PrintPart` with a 24 h expiry.
2. Live validation: parse → repair (if needed) → analyze → ready. The validation panel lists watertight, manifold, degenerate faces, flipped normals, self-intersections, units guess, and overhangs highlighted in the viewer.
3. Auto-repair with a before/after diff; the user can accept or revert.
4. Configure: material, color, finish, layer height (0.12/0.20/0.28 mm where the material supports it), infill (10–100%), supports (auto/none/tree), orientation (auto recommended / as uploaded / manual rotate), scale (%, with mm dimensions), quantity (1–500).
5. Quote updates live with 300 ms debounce. Quote shows: per-part material, machine time, support material, finish, handling, subtotal, shipping, tax estimate, total, lead time, and expiry (30 min).
6. Signing in is required only at checkout. Anonymous `PrintPart` and `Quote` claim to the account on login.

### 7.2 Slicing and quoting (authoritative numbers)
- Quotes for the upload path use a **real slicer run** (PrusaSlicer CLI in a sandbox) for print time and filament mass. Support mass uses the slicer's support output. If `SLICER_MODE=estimate`, the quote is labeled ESTIMATE and cannot be ordered until a real slice runs in production.
- Golden test: 20 mm calibration cube slice time within ±10% of a stored reference, per material profile.
- The listing path does not slice per order. The creator sets a fixed price per material and finish, and the platform prices from the listing's stored analysis (volume and surface area) and a per-material rate card.

### 7.3 Pricing engine (packages/pricing, pure functions, shared by browser estimate and server authority)
Configurable in `packages/pricing/config/v1.json`, versioned, with golden fixtures. The formula structure:

```
material_g   = (filament_g + support_g * support_factor) * waste_factor       // waste_factor default 1.08
material_cost = material_g * cost_per_g[material]
machine_cost  = (print_time_s / 3600) * machine_rate_per_h[technology]
setup_cost    = setup_fee[material] once per distinct (part, material, finish)
finish_cost   = finish.base + finish.per_cm2 * surface_area_cm2
unit_cost     = material_cost + machine_cost + finish_cost
unit_price    = max(min_unit_price, unit_cost * (1 + target_margin))
discounted    = round_half_up(unit_price * (1 − tier_discount(quantity)))  // tiers configurable
line_total    = discounted * quantity + setup_cost
shipping      = rate_table[zone(country)][billable_weight_tier] where billable_weight = max(actual_g, volumetric_g), volumetric_g = L*W*H_mm / 5000 * 1000 (confirm divisor against the chosen carrier and document it)
tax           = provider tax result if available; else config table with an ESTIMATE label
total         = subtotal − discount + shipping + tax, rounding at each step is documented
```

Listing-path price:

```
listing_unit_price = creator_price_policy[material][finish] (creator sets ≥ platform minimum)
platform_fee       = listing_unit_price * platform_fee_bps / 10000
creator_share      = (listing_unit_price − print_cost_estimate) * creator_share_bps / 10000  // only if positive; never negative
```

Edge cases, each with a test:
- Part exceeds build volume after orientation → `PART_TOO_LARGE`, suggests a scale.
- Scale < 1% or > 1000% → reject. Quantity < 1 or > 500 → reject. Mixed currency in one cart → reject.
- Quote expired → reprice. If the total moved more than 2%, return `409 QUOTE_CHANGED` with a diff and require re-accept.
- Minimum order value enforced.
- Promo codes: percent ≤ 100; fixed ≤ subtotal; never stack two percentage codes.
- Golden fixtures: 10 reference parts (cube 10 mm, cube 50 mm, sphere, thin-walled cylinder, a thin 0.6 mm feature, multi-part cart, and so on) with expected totals in committed JSON. Changing the engine requires updating fixtures in the same PR with a reviewer checklist item.

### 7.4 Partner network and routing
Define `PrintPartner` and `PartnerPrinter` as in Section 4.5. Routing picks a printer that:
1. Supports the chosen material and technology.
2. Fits the part's bounding box in the orientation the buyer chose.
3. Is `IDLE` or has the lowest queued-seconds estimate.
4. Ties broken by distance from the buyer's postal area to the partner's ship-from location.

Partner adapter interface: `listCapacity`, `submitItem`, `getItemStatus`, `cancelItem`, `parseWebhook`, `verifyWebhook`. Implement: `MockPartner` (deterministic, simulates queue, print, QC photo, shipping) and `OwnFleetPartner` (for an internal printer fleet, if the operator runs one). Do not invent a real partner integration.

Creator and buyer see the partner name and ship-from city, not the partner's internal IDs.

### 7.5 Fulfilment lifecycle and QC
- Routed items follow the `OrderItem` state machine (Section 8.2).
- Partner posts QC photos through the adapter, stored as `QC_PHOTO` files, visible to the buyer on the order page.
- Ops can run QC manually from the admin queue (pass / fail / rework with notes and photos).
- Failed QC triggers a reprint (max 2 automatic reprints per item), then escalates to ops with an SLA timer.

### 7.6 Shipping and tracking
- Carrier adapter interface: `getRates`, `buyLabel`, `parseWebhook`, `getTracking`. Mock carrier first. Real carrier chosen later (ADR).
- Tracking number and carrier link appear on the order page. Email at each step (Section 9).

### 7.7 Buyer protections and disputes
- Buyer can cancel in `PAID` before `IN_PRODUCTION` (automatic refund).
- Buyer can report a problem with a damaged or incorrect part within 14 days of delivery: photos required, routed to ops.
- Reprint or refund decided by ops against a written policy in `docs/policy-print.md`.

---

## 8. State machines (implement as pure transition tables in `packages/shared/src/machines/` with exhaustive unit tests)

Each machine exposes `transition(current, event)` that throws `InvalidTransition` on illegal moves. Every transition writes a `JobEvent` or `OrderEvent` row and emits a domain event.

### 8.1 Job
```
QUEUED      → RUNNING        (worker claims)
QUEUED      → CANCELED       (user/system before start; releases reservation)
RUNNING     → SUCCEEDED      (commit reservation)
RUNNING     → RETRYING       (retryable error; backoff)
RUNNING     → FAILED         (non-retryable or attempts exhausted; release)
RUNNING     → CANCELED       (after cancelTask confirmed; release)
RETRYING    → QUEUED         (backoff elapsed)
RETRYING    → FAILED         (attempts exhausted)
```
Credit side effects are part of the same transactions as the status change.

### 8.2 OrderItem
```
PENDING_PAYMENT → QUEUED_FOR_PRINT   (order PAID)
QUEUED_FOR_PRINT → ROUTED            (partner accepted)
ROUTED → PRINTING                    (partner status)
PRINTING → POST_PROCESSING
POST_PROCESSING → QC
QC → PASSED                          (ops or partner QC pass)
QC → REWORK_QUEUED                   (fail; auto reprint ≤ 2)
REWORK_QUEUED → ROUTED
QC → ESCALATED                       (third fail or buyer report)
PASSED → PACKED → SHIPPED (via carrier webhook or manual)
SHIPPED → DELIVERED (carrier) 
any non-terminal → CANCELED          (buyer in allowed window, or ops)
```

### 8.3 Order
```
DRAFT → AWAITING_PAYMENT           (checkout started; Stripe session created)
AWAITING_PAYMENT → PAID            (Stripe webhook: session completed AND amount == quote total AND currency matches)
AWAITING_PAYMENT → EXPIRED         (session expired)
AWAITING_PAYMENT → CANCELED
PAID → IN_PRODUCTION               (first item routed)
PAID → CANCELED                    (buyer within 1 h and before routing; auto refund)
IN_PRODUCTION → ON_HOLD            (ops)
ON_HOLD → IN_PRODUCTION
IN_PRODUCTION → PARTIALLY_SHIPPED
PARTIALLY_SHIPPED → SHIPPED
SHIPPED → DELIVERED
DELIVERED → CLOSED                 (after 14-day problem window)
any paid state → REFUNDING → REFUNDED | PARTIALLY_REFUNDED
```
Each Order transition with a Stripe effect uses an idempotency key derived from `order_id + transition + sequence`.

### 8.4 PrintPart
```
UPLOADED → SCANNING → ANALYZING → READY
ANALYZING → NEEDS_REPAIR → REPAIRING → ANALYZING
any → REJECTED (with reason; e.g., too many triangles, unsupported format, malware)
```

### 8.5 Credit reservation
```
RESERVED → COMMITTED | RELEASED | EXPIRED
```
A reservation expires at job timeout + 1 h. The reaper releases expired reservations and writes a `RELEASE` ledger row.

### 8.6 Quote
```
ISSUED → CONSUMED (order created) | EXPIRED (30 min) | SUPERSEDED (new quote for the same cart item)
```

---

## 9. Money, credits, and plans

### 9.1 Units and arithmetic
- Credits are integers. A credit has a fixed display value (for example, pack pricing implies about USD 0.01 per credit; set it in config).
- Money is integer minor units in code. No floats. Round half-up at documented points only.

### 9.2 Plans (defined in seed data, not code)
- **Free:** 100 credits/month, 2 concurrent jobs, GLB and STL export, private by default, may list in Shop (CC BY 4.0 forced on free-plan public assets), watermark-free, 14-day retention of failed previews.
- **Creator:** monthly subscription, 2,000 credits/month, 6 concurrent jobs, all formats, 4K textures, API access with 600 req/min, Shop listing with commercial license options.
- **Studio:** monthly subscription, 10,000 credits/month, 20 concurrent jobs, 8K textures, API with 3,000 req/min, priority queue, team seats (V1).
- Credit packs: 500, 2,500, and 10,000 one-off. Purchased credits never expire.
- Monthly plan credits expire at period end (ledger `EXPIRY`). Unused credits do not roll over, and this is written into Terms and the Billing page.

### 9.3 Credit rules
- Reservation uses the maximum cost of the job. Commit uses the actual cost (documented if lower). Release on failure, cancel, or expiry.
- Reserve and commit run in a single transaction that locks the wallet row `FOR UPDATE`.
- Subscription grants are idempotent on `grant:{invoice_id}`.
- Admin credit adjustments require a reason and an audit log entry. Adjustments above a threshold need a second admin.
- Property-based test (fast-check): across random sequences of reserve, commit, release, grant, expiry, refund, the wallet never goes negative, `reserved ≤ balance`, and `balance` equals the sum of ledger deltas. Run 10,000 iterations in CI.

### 9.4 Stripe
- Stripe Checkout for print orders and credit packs. Stripe Billing for subscriptions. Stripe Customer Portal for plan management.
- Prices and product IDs live in `Plan`, `CreditPack`, and the Stripe dashboard, not in code.
- Webhook events handled: `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`. Each one: verify signature with raw body, store in `StripeEventRaw`, process in a transaction that also marks `processed_at`, no-op on duplicates.
- Tax: use Stripe Tax if enabled on the account. Otherwise `tax_minor = 0` with a visible "tax calculated where applicable" notice, and a TODO in `docs/decisions.md`.
- Refunds: `POST /admin/refunds` creates a Stripe refund with an idempotency key. Refunds above the configured threshold need a second admin approval before the Stripe call.
- Reconciliation: nightly job compares `Payment`, `Order`, and `Refund` with Stripe and writes discrepancies to an admin report. Must exist before go-live.

### 9.5 Creator payouts (listing path)
- Creator share accrues in `Payout` as `PENDING` once the order is `DELIVERED` and the 14-day problem window closes.
- Payouts are sent through a connected-account provider (Stripe Connect or equivalent) with idempotency keys. Until the connected-account integration exists, accrue balances only and show them as "pending payout" with a feature flag. Do not pay out manually from code.
- Reversals on refund: `Payout` → `REVERSED` and a ledger offset.

---

## 10. API surface

Conventions: `application/json`, cursor pagination (`?cursor=&limit≤100`) with `{ data, next_cursor }`. Errors are `{ error: { code, message, details, request_id } }`. Every response includes `X-Request-Id`. ISO 8601 UTC timestamps. Zod schemas in `packages/shared` generate `openapi.yaml`. Breaking changes are blocked in CI with `oasdiff`.

### 10.1 Auth and account
- `POST /v1/auth/magic-link` (rate limit: 5 per email per 10 min, 20 per IP per hour)
- `POST /v1/auth/magic-link/consume`
- `POST /v1/auth/logout`
- `GET /v1/me`, `PATCH /v1/me`
- `POST /v1/me/email-change`
- `POST /v1/me/export` → `job_id` (ZIP via signed URL)
- `DELETE /v1/me` → 30-day `PENDING_DELETION`

### 10.2 Keys and webhooks
- `GET|POST /v1/api-keys`, `DELETE /v1/api-keys/:id`
- `GET|POST /v1/webhooks`, `PATCH|DELETE /v1/webhooks/:id`
- `POST /v1/webhooks/:id/test`
- `GET /v1/webhooks/:id/deliveries`, `POST /v1/webhooks/deliveries/:id/replay`

### 10.3 Studio generation
- `POST /v1/studio/text-to-3d` body: `{ model, mode: "preview"|"refine", prompt, negative_prompt?, style, topology, polycount_target, parent_asset_version_id? (required for refine) }` → `202 { job }`
- `POST /v1/studio/image-to-3d` body: `{ model, upload_ids[1..4], background_removal, symmetry, topology, polycount_target }`
- `POST /v1/studio/multi-image-to-3d` body: `{ model, views: [{ label, upload_id }] }`
- `POST /v1/studio/retexture` body: `{ model, asset_version_id, prompt | reference_upload_id, outputs[], resolution }`
- `POST /v1/studio/remesh` body: `{ asset_version_id, target_faces, preserve_uv, preserve_boundary }`
- `POST /v1/studio/exports` body: `{ asset_version_id, format, texture_resolution, units, up_axis }` → export job
- `GET /v1/studio/estimate?kind=…&model=…&options=…` → credits (no reservation)
- `GET /v1/studio/models` → catalog with capabilities and costs
- `GET /v1/jobs/:id`, `GET /v1/jobs/:id/events` (SSE), `POST /v1/jobs/:id/cancel`, `POST /v1/jobs/:id/retry` (FAILED only)

### 10.4 Uploads
- `POST /v1/uploads` → `{ upload_id, put_url, expires_at }` (presigned PUT, bound to content-length and content-type, 15 min)
- `POST /v1/uploads/:id/complete` → starts scan
- `GET /v1/uploads/:id` → status

### 10.5 Library and shop
- `GET /v1/assets?cursor&limit&kind&status&tag&q&sort&print_enabled`
- `GET|PATCH|DELETE /v1/assets/:id` (PATCH: title, tags, visibility, license; DELETE: soft)
- `GET /v1/assets/:id/versions`
- `GET /v1/assets/:id/files/:file_id/url` → presigned GET, 5 min
- `POST /v1/collections`, `GET|PATCH|DELETE /v1/collections/:id`, `POST /v1/collections/:id/items`
- `PUT /v1/assets/:id/listing` (creator enables/updates printing; moderation gate)
- `GET /v1/shop/listings?cursor&q&material&sort`
- `GET /v1/shop/listings/:asset_id`

### 10.6 Print
- `POST /v1/print/parts` body: `{ upload_id }` or `{ asset_version_id }` (anonymous allowed for upload_id)
- `GET /v1/print/parts/:id`, `GET /v1/print/parts/:id/events` (SSE)
- `POST /v1/print/parts/:id/repair` → job
- `PATCH /v1/print/parts/:id` body: `{ material, color, finish, layer_height, infill, supports, orientation, scale_pct, quantity }` → triggers slice and quote recalc
- `GET /v1/print/materials`, `GET /v1/print/finishes`
- `POST /v1/print/quotes` body: `{ part_ids[], shipping_address? }` → `Quote` (30 min)
- `GET /v1/print/quotes/:id`
- `POST /v1/print/quotes/:id/claim` (anonymous → account)
- `POST /v1/print/listing-orders` body: `{ asset_id, material, color, finish, quantity, address_id }` → quote
- `GET|POST|PATCH|DELETE /v1/cart`, `… /cart/items/:id`
- `POST /v1/checkout` headers `Idempotency-Key` body `{ quote_id, address_id, shipping_method }` → `{ order, stripe_checkout_url }`
- `GET /v1/orders?cursor`, `GET /v1/orders/:id`, `GET /v1/orders/:id/events`
- `POST /v1/orders/:id/cancel` (only within the cancel window)
- `POST /v1/orders/:id/problems` (photos required)
- `GET /v1/orders/:id/invoice` → presigned PDF

### 10.7 Billing
- `GET /v1/billing/plans`, `POST /v1/billing/subscribe`, `POST /v1/billing/portal`
- `POST /v1/billing/credit-packs/:code/checkout`
- `GET /v1/billing/wallet`, `GET /v1/billing/ledger?cursor`, `GET /v1/billing/invoices`
- `POST /v1/promo/validate`

### 10.8 Internal (signature or token verified; no cookies)
- `POST /internal/stripe/webhook`
- `POST /internal/providers/:key/webhook`
- `POST /internal/partners/:key/webhook`
- `POST /internal/carriers/:key/webhook`

### 10.9 Admin (role-gated, MFA-protected, every write audited)
- Users: `GET /admin/users?q=`, `GET /admin/users/:id`, `POST /admin/users/:id/credits` (reason required), `POST /admin/users/:id/suspend`
- Jobs: `GET /admin/jobs?status=FAILED`, `POST /admin/jobs/:id/retry`
- Orders: `GET /admin/orders/board`, `PATCH /admin/orders/:id/status` (state machine enforced), `POST /admin/orders/:id/quote-override` (reason required)
- Items: `POST /admin/order-items/:id/qc` (result, notes, photo_upload_ids)
- Partners and printers: `GET|PATCH /admin/partners`, `GET|PATCH /admin/printers`, `POST /admin/printers/:id/state`
- Pricing: `GET|POST /admin/pricing/versions`, `POST /admin/pricing/preview`
- Shop moderation: `GET /admin/listings/pending`, `POST /admin/listings/:id/approve|reject`
- Refunds: `POST /admin/refunds` (idempotent; second-approval threshold)
- Audit: `GET /admin/audit-log?actor=&action=&target=`
- Reconciliation: `GET /admin/reconciliation/report`

### 10.10 Rate limits
Token bucket in Redis per key or user. Free 60/min. API keys by plan (Creator 600/min, Studio 3,000/min). Generation endpoints also cap concurrent jobs per plan. 429 responses include `Retry-After`.

---

## 11. Frontend: information architecture and screens

### 11.1 Brand and design system
- Create an original name, wordmark, and icon. Use one brand name across both products (for example, "one product, two modes: Create and Print").
- Tokens in `packages/ui/tokens.css`: at least 3 neutrals, 1 accent, and success, warning, danger, info. Light and dark themes from day one; respect `prefers-color-scheme` and a user toggle stored in a cookie.
- Typography: one UI sans, one mono for prices, dimensions, and IDs. Tabular numerals for money and mm.
- Spacing scale 4/8/12/16/24/32/48. Breakpoints 640/768/1024/1280. Every page works at 360 px with no horizontal scroll.
- All strings in `apps/web/src/i18n/en.ts` (no hard-coded copy in components).

### 11.2 Navigation
- Top bar: logo · Create (menu: Text to 3D, Image to 3D, Multi-image to 3D, Retexture, Remesh, Print a file) · Library · Shop · Orders · Developers · credit badge (available balance + "Add credits") · avatar menu (Account, Billing, API keys, Sign out, Admin if role).
- Mobile: bottom tab bar with Create, Library, Shop, Orders, Account.

### 11.3 Screen list (build all)
1. **Landing:** explains both modes with real example models from the seeded public gallery; pricing; FAQ; footer with legal links. Lighthouse mobile performance ≥ 90.
2. **Auth:** magic link and Google; sign-up collects email and name; terms and privacy versions stored with acceptance.
3. **Text to 3D studio** (Section 6.1).
4. **Image and multi-image studio** (Section 6.2).
5. **Job detail** (Section 6.3).
6. **Asset detail:** viewer, versions, files, license, print status, "Enable printing" (creator flow).
7. **Library** (Section 6.9).
8. **Shop:** grid of printable listings with filters (material, price, sort), listing page with "Order print" panel (material, color, finish, quantity, price breakdown, delivery estimate, creator name and license).
9. **Upload print:** drop zone, validation panel, viewer with overlay, repair diff, configure panel, live quote panel.
10. **Quote summary and cart:** per-part lines, totals, expiry countdown, promo code, "Continue to checkout" (sign-in required here).
11. **Checkout:** address with validation, shipping method, terms version acceptance, Stripe Checkout redirect, return page polling order status.
12. **Orders:** list; detail with status timeline, QC photos, tracking, invoice, "Report a problem," "Cancel" when allowed.
13. **Billing:** plan, wallet, ledger (append-only history), credit packs, invoices, subscription cancel/resume via portal.
14. **Developers:** keys (create, name, scopes, last used, revoke), usage chart per key, quickstarts (curl, Node, Python) that call the real API, webhook management with test send and delivery log with replay.
15. **Account:** profile, email change with verification, connected sign-in methods, data export, deletion request.
16. **Creator dashboard:** listings, earnings pending/paid, orders received.
17. **Admin:** users, jobs, order board (Kanban by status), partners and printers fleet, QC queue, pricing versions with preview calculator, listing moderation, refunds, audit log, reconciliation report, feature flags.
18. **Status:** `/status` public health from the API.
19. **Error and empty states:** 404, 403, 500; empty libraries, carts, orders.

### 11.4 UI quality bar
- Every async action shows loading, success, and error with Retry.
- Optimistic updates only for reversible actions (rename, favorite, reorder).
- Modals trap focus, close on Escape, return focus on close.
- Keyboard path through every studio and print form. Viewer is operable by keyboard.
- WCAG 2.2 AA contrast; focus rings visible; `prefers-reduced-motion` respected; icon buttons have labels.
- Axe-core clean (zero serious or critical) on every top-level route.

---

## 12. Security

Threat-model each surface in `docs/security.md` with STRIDE: uploads, provider webhooks, Stripe webhooks, partner webhooks, file access, admin actions, API keys, listing purchases, creator payouts. Each mitigation links to a test.

Mandatory controls:
- Zod strict schemas on all input (`.strict()`, unknown keys rejected). JSON body max 1 MB; uploads go direct to object storage via presigned PUT.
- **Uploads:** extension and MIME allowlist; magic-byte sniff; size limit (150 MB print, 20 MB images); 3MF/ZIP zip-bomb protection (max uncompressed 500 MB, max entries 5,000); triangle cap 25M; parser timeouts; quarantine prefix never served; scan result gates the move to permanent storage.
- **Mesh service isolation:** no network, read-only filesystem except a per-job temp directory, CPU and memory limits, 120 s wall clock, output size cap.
- **Files:** signed URLs, 5 min for downloads, 15 min for uploads, bound to content type and length. Private assets return 404 to non-owners, not 403.
- **IDOR tests** for every resource type: user A cannot read, change, or cancel user B's asset, job, quote, cart, order, invoice, webhook, or key.
- **Money:** server recomputes every price. Client amounts ignored. Stripe amount and currency checked against the quote before fulfilment. Idempotency keys on all Stripe calls.
- **Auth:** magic link single use and 15 min; session rotation on login; 14-day idle and 30-day absolute timeouts; logout invalidates server session.
- **Admin:** TOTP MFA required for ADMIN, OPS, and SUPPORT roles. Every write audited. Second approval for refunds above threshold and for credit adjustments above threshold.
- **Abuse:** signup throttling, disposable email block list, CAPTCHA after three failed attempts, prompt moderation, rate limits, listing moderation gate for the Shop.
- **Logging:** redact `authorization`, `cookie`, `set-cookie`, Stripe and provider signature headers, API keys, and emails (hash emails in logs).
- **Headers:** strict CSP with nonces, HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera, mic, and geolocation.
- **Supply chain:** `pnpm audit` in CI, Renovate or Dependabot, CycloneDX SBOM on release.
- **Privacy:** GDPR export and deletion; cookie banner only for non-essential cookies; `docs/privacy.md` with retention periods per data class.

---

## 13. Observability, operations, and launch gates

- Structured logs (pino) with `request_id`, `user_id` (hashed in external sinks), `job_id`, `order_id`.
- OpenTelemetry traces across web → api → worker → mesh-service, exported over OTLP.
- Prometheus metrics at `/metrics`: `job_duration_seconds{kind,provider,model}`, `job_failures_total{error_code}`, `queue_depth`, `provider_latency_seconds`, `slicer_duration_seconds`, `stripe_webhook_lag_seconds`, `order_status{status}`, `credit_reservations_open`, `partner_queue_seconds`, `qc_fail_ratio`.
- Alerts: queue depth > 500 for 5 min; provider circuit open; Stripe webhook failures > 3 in 10 min; reconciliation discrepancy > 0; reservations open > 2 h; QC fail ratio > 10% over 50 items; partner SLA breach.
- Feature flags for every external integration so each can be turned off without a deploy.
- Runbooks in `docs/runbooks/`: stuck jobs, provider outage, webhook backlog, partner offline, lost parcel, refund escalation, payout reversal.

Launch gates (all must be true before any real money is taken):
1. Reconciliation job green for seven consecutive days in staging with Stripe test mode.
2. Refund and reversal paths tested end to end.
3. Quote-tamper test passing.
4. Terms, privacy, print-order policy, and listing license text reviewed by counsel (flagged in `docs/HANDOFF.md`).
5. Sales tax registration plan documented.
6. Partner contract (or own-fleet operating plan) and insurance for physical goods flagged as external dependencies.

---

## 14. Testing

- **Unit (vitest):** pricing engine (≥ 60 table cases plus golden fixtures), every state machine transition legal and illegal, credit math (property-based), Zod schemas, provider normalization, webhook dedupe and out-of-order handling, signature verification.
- **Integration:** API against real Postgres and Redis (testcontainers or compose). Worker end-to-end with mock provider. Ledger trigger rejects UPDATE and DELETE. Outbox relay recovers after a simulated crash between commit and publish.
- **Contract:** `openapi.yaml` validates; generated client typechecks; `oasdiff` breaking-change gate.
- **Python (pytest):** golden meshes: unit cube, sphere with hole, flipped normals, non-manifold edge, 3MF with nested components, zip bomb, 25M-triangle reject. Slicer golden: 20 mm cube within ±10%.
- **E2E (Playwright), journeys:**
  - J1 Text preview → refine → export GLB (mock). Credits reserved, committed; SSE in order; asset in library; download works.
  - J2 Image upload with wrong MIME rejected; valid PNG scanned, moved from quarantine, generates an asset.
  - J3 Upload STL (anonymous) → non-manifold warning → repair → PASS → quote → material change updates price within 1 s → sign-up at checkout → claim → order.
  - J4 Shop listing: creator enables printing → moderation approves → buyer orders → partner mock routes → QC pass → shipped → delivered → creator payout accrues.
  - J5 Quote tamper: client-sent price ignored; mismatch returns 409 or reprices.
  - J6 Stripe checkout with test card; webhook processed once even when delivered twice; order PAID only when amount and currency match.
  - J7 Subscription to Creator; `invoice.paid` grants 2,000 once even if delivered twice.
  - J8 API key with `studio:generate` only: text-to-3D → 202; `GET /v1/billing/invoices` → 403 `INSUFFICIENT_SCOPE`.
  - J9 Developer webhook: job succeeded → signed POST received → signature verifies → replay works.
  - J10 Admin partial refund: Stripe refund recorded; OrderEvent written; credits reversed if applicable; second approval enforced above threshold.
  - J11 Provider webhook duplicate and out-of-order: job never regresses from SUCCEEDED; reservation committed exactly once.
- **Accessibility:** axe-core on each top-level route.
- **Security:** OWASP ZAP baseline in CI (fails on high).
- **Load:** k6 — 200 generation jobs over 10 min against mock provider; p95 API latency < 300 ms; zero lost jobs.
- **Visual:** screenshot baseline for landing, studio, upload, quote, order detail.

---

## 15. Build order: vertical slices (each ends in a commit, green tests, and an entry in `docs/progress.md`)

**Slice 0 — Discovery (commit first):** all files in `docs/` listed in Section 16. Do not write app code before this commit.

**Slice 1 — Foundation:** monorepo, tooling, env validation, docker-compose, Prisma schema v1, first migration, seeds (plans, credit packs, materials, finishes, 2 mock partners with printers, pricing v1, generation models for the mock provider), health endpoint, CI workflow file.
DoD: `pnpm dev` boots all services; `GET /v1/health` green; `pnpm lint typecheck test` pass.

**Slice 2 — Identity and keys:** magic link, Google, sessions, CSRF, API keys with scopes, rate limits, IDOR harness.
DoD: J8 partly passing (scopes); security tests green.

**Slice 3 — Credits:** wallet, reserve, commit, release, ledger trigger, property tests, admin adjustment with audit.
DoD: 10,000 property iterations green; ledger immutability test green.

**Slice 4 — Studio core:** job engine with outbox, workers, mock provider, text-to-3D preview, SSE, library list, asset files, signed download, GLB viewer (basic).
DoD: J1 through preview and GLB export.

**Slice 5 — Studio complete:** refine (parent-child jobs), image and multi-image, retexture, remesh, export formats, collections, Shop listing with moderation, developer webhooks with signatures and retries, one real provider adapter if docs allow (otherwise stub with NotImplemented and say so).
DoD: J1 full, J2, J9.

**Slice 6 — Mesh service and viewer:** analyze, repair, decimate, LOD, orient, convert; golden tests; viewer with LOD and print overlay.
DoD: 500k-triangle fixture at 30 fps; J3 analysis and repair portion.

**Slice 7 — Print quoting:** upload scan, slicer container (real or estimate mode), pricing engine v1 with golden fixtures, anonymous parts and quotes, claim on login, cart.
DoD: J3 through quote; J5 passes; pricing golden tests pass.

**Slice 8 — Checkout and orders:** Stripe Checkout, webhook processing, order state machine, OrderEvents, emails, invoice PDF, mock carrier label and tracking, partner routing against mock partners, listing-path orders, creator payouts accrual.
DoD: J4, J6, J7, J11.

**Slice 9 — Ops and admin:** order board, partners and printers fleet, QC flow, quote overrides, refunds with second approval, audit viewer, users and jobs admin, moderation queue, feature flags UI, reconciliation report.
DoD: J10 passing; admin axe-clean.

**Slice 10 — Hardening and launch prep:** security checklist with evidence, OWASP ZAP, k6, dashboards and alerts JSON, runbooks, legal page drafts flagged for counsel, DMCA workflow, accessibility pass, landing Lighthouse ≥ 90.
DoD: all E2E green; `docs/security.md` has evidence links to tests.

---

## 16. Discovery deliverables (Slice 0, commit before any app code)

- `docs/product.md` — Feature inventory for Studio and Print, grouped MVP / V1 (next 60 days) / Later. Each feature: user story, acceptance criteria, API and UI surface. Must explicitly cover both Print entry points (Section 7.1).
- `docs/research.md` — Section 1 restated with source URLs and retrieval date. Every "UNVERIFIED" item gets an open question entry.
- `docs/architecture.md` — Mermaid container diagram, responsibilities, sync vs async boundaries, data flow for journeys J1, J3, J4, J6, J10.
- `docs/data-model.md` — Section 4 expanded to full field lists.
- `docs/state-machines.md` — Section 8 expanded with events, guards, and side effects.
- `docs/security.md` — STRIDE per surface (Section 12).
- `docs/pricing.md` — Section 7.3 and 9 with formulas, example worked calculations for three parts, and the rules for the listing path.
- `docs/policy-print.md` — Draft print-order policy (cancel window, problem window, reprint and refund rules). Flagged for counsel.
- `docs/decisions.md` — ADR log. Required entries: ADR-001 Fastify API; ADR-002 Python mesh service; ADR-003 transactional outbox; ADR-004 credit model (reserve max, commit actual); ADR-005 two Print entry points; ADR-006 creator share and payout model; ADR-007 provider choice and signature verification method (with the chosen provider's rules); ADR-008 free-tier license default; ADR-009 tax approach; ADR-010 partner routing rules; ADR-011 anonymous quotes and claim-on-login.
- `docs/risks.md` — Top 10 risks with likelihood, impact, mitigation, owner. Must include: provider price or terms change, provider webhook unreliability, print partner quality, shipping damage, chargebacks, copyright claims on public models, print cost underestimation, slicer accuracy, tax compliance, creator fraud.

---

## 17. Deliverables at the end (`docs/HANDOFF.md`)

1. What works end to end today, with exact demo commands.
2. What is mocked or stubbed (provider, slicer estimate mode, tax, carrier, partner network, payouts), and what real credential or contract each one needs.
3. Known gaps ranked by risk: money, data, legal, operations, UX.
4. Launch checklist: legal items from `docs/policy-print.md` and Terms and Privacy, sales tax, partner contracts, product liability insurance, creator payout provider, reconciliation sign-off.
5. The three riskiest assumptions and a one-week test plan for each (for example: "buyers accept nearest-partner pricing at our margin").
6. Next 10 tickets, each sized in days.
7. A parity matrix: each verified competitor feature from Section 1 mapped to our status (built / mocked / planned / intentionally excluded), with the reason for each exclusion.

---

## 18. Working rules for the agent

- Commit after each slice with conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Do not put model names or tool names in commit messages, code comments, or docs beyond what the decisions log requires.
- Before each slice, re-read the relevant `docs/` file and update it if your design changed. Docs match code at every commit.
- If a credential is missing, implement the mock path, put a TODO referencing the env var, and continue.
- Do not add a dependency whose license is incompatible with a closed-source commercial SaaS. Justify every new top-level dependency in `docs/decisions.md`.
- Do not stop to ask questions. Pick the defensible option, record it, move on.
- Final message: summarize what shipped per slice, what is mocked, what tests pass (paste the commands and their exit status), and the open questions.

Begin with Slice 0. Before writing the first file, post a one-paragraph plan naming the provider you intend to integrate and why.
