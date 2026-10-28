# ADDENDUM TO THE BUILD PROMPT — Modules 4 and 5

Attach this after the workable build prompt (`opus-workable-prompt.md`). Everything in the base prompt still applies: original brand and code, official APIs only, sandboxed AI code, server-authoritative money, and "do not stop to ask."

These modules add two things:
- **Module 4 — Customizer and Library** (STL Buddy-style): parametric generators people personalize with their own text, names, sizes, or photos, plus a community library of models and seller tools.
- **Module 5 — Fitment Parts and Print-to-Order** (3DCarParts-style): a car-part repository where every part is tagged to exact vehicles, with a request board, printed parts, and a verified-fit custom-design service.

Build these after Slice 6 (Generate complete) and before Slice 8 (checkout). Module 5 depends on the Print pipeline from Slice 7.

---

## 0. Scope rules for these modules

1. **Original product.** Do not copy the names, logos, screenshots, copy, layouts, or code of STL Buddy, 3DCarParts, Thingiverse, Printables, MakerWorld, Cults3D, Etsy, Gumroad, or any other site. Do not scrape any site to populate the library or the fitment catalog. Seed content only from models your team creates, models with licenses that explicitly permit redistribution (recorded per model), and data from official public sources.
2. **Licenses are data.** Every model, part, and generator stores its license and attribution text. The app must refuse to publish a model with no license, and must show the license and required attribution on every page where the model appears. Support at least: `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `ALL-RIGHTS-RESERVED` (download for personal print only, no resale), and a custom license with uploaded text. Non-commercial licenses block listing orders and Shop sales.
3. **Safety-critical parts are blocked from print-to-order.** The platform never sells or prints parts for these systems: brakes and brake lines, steering components, suspension and wheel-attachment parts, seat belts and anchorages, airbag and restraint components, fuel system pressure parts, and anything that carries load in a crash. Classify every part in the catalog into a `safety_class` (`NONE`, `COSMETIC`, `ENCLOSURE`, `SAFETY_CRITICAL`). Only `NONE`, `COSMETIC`, and `ENCLOSURE` can be ordered or printed. `SAFETY_CRITICAL` parts show a clear "not available for printing" message and can be downloaded only where the license allows, with a written safety warning shown before download. Enforce this on the server, not just in the UI. A test must fail if a `SAFETY_CRITICAL` part can reach a checkout or a print order.
4. **Vehicle and trademark use.** Vehicle makes, models, and years appear only as factual fitment labels, never as logos or brand imagery. Do not imply affiliation with any manufacturer. Add a footer disclaimer that the platform is not affiliated with any vehicle manufacturer.
5. **Money and orders follow the base prompt's rules**: server prices, idempotent orders, audited refunds, and the same order state machine.

---

## 1. Module 4 — Customizer and Library (STL Buddy-style)

### 1.1 What the user gets
- **Customizers:** a catalog of parametric generators. A user picks one, fills in the fields it exposes (a name, a photo, a size, a color choice), sees a live preview, and exports an STL, 3MF, or print-ready file. Examples to ship as starters: a name plate or keychain with custom text, a modular storage tile with size and grid options, a coaster with an image-derived relief, a cable organizer with a parametric count.
- **Library:** community models with free and paid listings. Browse, search, filter by license, tags, print time, and material. Download free models, save to collections, and enable printing (Module 5 uses the same print pipeline).
- **Seller tools:** a print cost calculator (material, time, and margin inputs, using the same pricing engine as the base prompt) and a listing helper that drafts a title, description, and tags from a model's metadata. The helper is a deterministic template in the MVP. An LLM writer can be added later behind the author interface.

### 1.2 Customizer engine
- A customizer is a Forge with a different front end. Reuse `packages/forge-kit` and the same sandbox, schema, and verification rules from the base prompt. Do not write a second code runner.
- **Input types beyond numbers:** text (with a max length and a character allowlist for names), enum, boolean, color, and image upload. Image inputs are processed in the mesh service (grayscale conversion, resize to a documented grid, and a relief height map). The output mesh must stay inside the printer's build volume and pass the same `verify` checks.
- **Preview cost:** rebuilding a customizer preview is free for the user until they export. Export charges credits according to the same cost table as Generate. Free-plan users get a fixed number of free exports per month, defined in seed data.
- **Export limits:** free users get STL only, with a small visible footer on the export page indicating the generator. Paid plans remove the footer and add 3MF. Do not add watermarks to printed parts.

### 1.3 Library data model additions
- `Customizer` (id, title, description, author_id, license, forge_source_id, input_schema jsonb, price_policy, status `DRAFT|REVIEW|LIVE|REMOVED`, print_defaults jsonb)
- `LicenseTerms` (id, code, text, attribution_template, allows_commercial bool, allows_derivatives bool, allows_print_order bool)
- `ModelLicense` (asset_id, license_id, attribution_text, source_url optional, verified_by, verified_at)
- `Collection` and `CollectionItem` (already in the base prompt; reuse)
- `Download` (user_id, asset_id, created_at, license_snapshot) — audit trail for free and paid downloads; used for creator statistics and takedown responses.

### 1.4 Moderation for public library items
- Every public item goes through a review queue before it is listed. Reviewers check: license is valid and attribution is present, no trademarked logos or characters in the mesh or texture, no weapons or prohibited items (see the platform policy in `docs/policy-content.md`, to be written), and the safety class if the item is a vehicle part.
- A takedown workflow (from the base prompt) hides an item, notifies the owner, logs the action, and supports counter-notice.

### 1.5 Module 4 acceptance tests
- A user with a free plan exports a name plate STL with custom text; the file's bounding box matches the schema's computed dimensions; the footer appears in the export page.
- A customizer rejects text containing characters outside the allowlist, and clamps out-of-range sizes with a visible message.
- A model with no license cannot move from `DRAFT` to `LIVE`.
- A `CC-BY-NC-4.0` item shows "Order print" disabled with the reason "non-commercial license."
- Seller calculator output matches the pricing engine's output for the same inputs (shared golden fixture).

---

## 2. Module 5 — Fitment Parts and Print-to-Order (3DCarParts-style)

### 2.1 What the user gets
- **Parts library organized by vehicle.** Every part is tagged to one or more vehicle configurations. Browse by year, make, model, and optionally engine, trim, and body style. Search by part name or part number the uploader provided.
- **Fit-first search.** A user enters their car (year, make, model, plus engine or trim where it matters). Results show only parts marked as fitting that configuration, plus parts marked as "fits with modification" in a separate tab.
- **Download free** (where the license allows) or **order printed** (where `print_order` is permitted by the license and the part's safety class is allowed).
- **Request board:** an owner posts a part they need (vehicle, description, photos, measurements). Other users, makers, and partner shops can respond. Requests have a status (`OPEN`, `CLAIMED`, `DESIGNED`, `FULFILLED`, `CLOSED`) and a visible claim by one responder at a time.
- **Custom design service:** the owner sends a reference part, photos, or measurements. A designer (a verified contributor or a partner shop) produces a model and a print. The buyer approves the design before any print is made. The design is delivered with a fit statement and an offer of the platform's fit guarantee, which must be defined as a written policy in `docs/policy-fit.md` and reviewed by counsel before launch.
- **Shop partners:** print shops apply, pass a review (materials, capacity, quality samples), and receive routed print work by region. Reuse the `PrintPartner` interface from the base prompt.

### 2.2 Fitment data model (the part that makes or breaks this module)
The problem to avoid: the known weakness of this category is that parts are not cross-referenced for fit across generations or mechanically identical models. Solve it explicitly.

- `Vehicle` (id, year, make, model, body_style, engine_code, trim, drivetrain, source, source_ref, created_at). Seeded from an official public vehicle data source. Before writing the importer, read the current documentation of the chosen source (the NHTSA vPIC API is the candidate for US vehicles. Verified on 2026-10-28: list makes at `/vehicles/GetAllMakes?format=json`, models by make at `/vehicles/GetModelsForMake/{make}?format=json`, models by make and year at `/vehicles/GetModelsForMakeYear/make/{make}/modelyear/{year}?format=json`, with the base URL inferred as `https://vpic.nhtsa.dot.gov/api`. The docs publish no numeric rate limit and no license or attribution requirement, but they do say traffic is rate-controlled, so cache responses. Confirm the base URL with one live request before relying on it) and record the choice in `docs/decisions.md` as ADR-M5-1. Do not scrape any site to build this table.
- `VehicleGroup` (id, name, reason, verified_by). A group of vehicle rows that share a fit family, such as the same chassis and drivetrain across a model run. Grouping is a human-verified assertion with a written reason, for example "same chassis and body, same suspension mounting points."
- `Part` (id, title, description, part_number_text, category, safety_class, license_id, owner_id, status, print_order_allowed bool, created_at)
- `PartFitment` (part_id, vehicle_id, fit_status `VERIFIED|COMMUNITY|UNVERIFIED|MODIFICATION_REQUIRED`, verified_by, verified_at, evidence_asset_ids[], notes)
- `FitmentCheck` (id, part_id, vehicle_id, check_type `MEASURED|PHOTO|OWNER_REPORT|DESIGNER_SPEC`, result, reporter_id, created_at)

Rules:
- Search results for a vehicle include `VERIFIED` fitments directly. `COMMUNITY` fitments appear with a visible label "owner-reported." `UNVERIFIED` fitments do not appear in fit-first search. They appear only under "all parts tagged to this vehicle."
- A `VehicleGroup` can propagate fitment: a part verified for one vehicle in a group shows as `COMMUNITY` for the others, with the label "fits a related model, not yet verified." Verifying a propagated fitment is a one-click action for a reviewer, and it creates a `FitmentCheck` row.
- Every fitment verification or group assignment writes an audit log entry with the reviewer's ID and reason.
- Fitment data is versioned by source. An importer change must not silently delete verified fitments.

### 2.3 Printed-part flow
1. Buyer opens a part with `print_order_allowed=true` and a non-blocked `safety_class`. The buyer picks their vehicle (or confirms the part's listed fitment) and a material from the allowed list for that category (for example, ASA or PETG for exterior trim, a higher-temperature material for under-hood enclosures).
2. The platform shows a clear fit disclaimer: "Printed parts are not OEM and may differ in fit and finish. Check fit before installing." The buyer acknowledges it. The acknowledgement is stored with the order.
3. Quote and checkout reuse the base prompt's Print pipeline, including the same material and pricing rules.
4. Routing goes to a partner or the internal fleet, using the same `PartnerPrinter` routing rules.
5. Post-delivery: the buyer can report a fit problem with photos, which opens a `FitmentCheck` with `OWNER_REPORT` and moves the fitment to `COMMUNITY` or `UNVERIFIED` for review. Repeated reports from different buyers on the same part and vehicle lead to automatic demotion from `VERIFIED` pending review.

### 2.4 Custom design flow
- Request states: `OPEN → CLAIMED → DESIGN_SUBMITTED → BUYER_APPROVED → PRINTING → DELIVERED`, with branches `DESIGN_REJECTED → CLAIMED` (up to two revisions) and `CANCELED`.
- The buyer approves the design preview before any print order is created. A print order is created only from an approved design version.
- Designer payouts follow the creator payout rule from the base prompt: accrue as pending, pay only after delivery and the problem window, and never pay out from application code until a payout provider is integrated.
- Measurements and reference files are stored as private assets, visible only to the buyer, the claimed designer, and admins.

### 2.5 Module 5 acceptance tests
- A search for a 2016 vehicle returns only `VERIFIED` fitments in the primary tab; `UNVERIFIED` parts do not appear in fit-first search.
- A part verified for one vehicle in a `VehicleGroup` shows as `COMMUNITY` for a sibling vehicle, with the propagated-label text.
- A part with `safety_class=SAFETY_CRITICAL` cannot be added to a cart, cannot be quoted, and cannot be routed to a printer, even if a client sends its ID directly. A test sends the request with a forged cart item and expects `403 PART_NOT_PRINTABLE`.
- A part whose license has `allows_print_order=false` shows the order button disabled, and the API rejects a direct order with the same error code.
- A custom design cannot be printed until the buyer approves a specific design version; approving version 2 does not approve version 1.
- Two buyer fit reports for the same part and vehicle within 30 days demote the fitment from `VERIFIED` and create a review task.

---

## 3. Additions to the API (namespace `/v1`)

Module 4:
- `GET /v1/customizers`, `GET /v1/customizers/:id`, `POST /v1/customizers/:id/previews` (rebuilds preview, debounced client-side), `POST /v1/customizers/:id/exports` (charges credits or uses a free allowance)
- `GET /v1/library/models?q&license&tag&print_time_max&material&cursor`
- `GET /v1/library/models/:id` (returns the license and attribution block)
- `POST /v1/library/models/:id/download` (records a `Download` row; returns a signed URL)
- `POST /v1/library/models/:id/publish` (moderation queue)
- `GET /v1/sellers/cost-calculator?material&grams&minutes&margin` (same engine as checkout)

Module 5:
- `GET /v1/vehicles?year&make&model&engine&trim` (paged, cached)
- `GET /v1/parts?vehicle_id&fit=verified|all&category&q&cursor`
- `GET /v1/parts/:id` (fitments, safety class, license, print status)
- `POST /v1/parts/:id/fitment-reports` (buyer report with photos)
- `POST /v1/requests`, `GET /v1/requests?vehicle_id&status`, `POST /v1/requests/:id/claim`, `POST /v1/requests/:id/designs` (designer uploads a version), `POST /v1/requests/:id/designs/:version/approve` (buyer), `POST /v1/requests/:id/designs/:version/reject`
- `POST /v1/parts/:id/print-quotes` (routes through the base prompt's quote engine; server rejects blocked parts with `403 PART_NOT_PRINTABLE`)

Admin:
- `POST /admin/fitments/:id/verify`, `POST /admin/vehicle-groups`, `POST /admin/vehicle-groups/:id/members`
- `GET /admin/moderation/queue?type=library|part|request`, `POST /admin/moderation/:id/decision`
- `POST /admin/parts/:id/safety-class` (reason required, audited)

Error codes to add to the shared package: `PART_NOT_PRINTABLE`, `LICENSE_FORBIDS_PRINT`, `LICENSE_MISSING`, `FITMENT_UNVERIFIED`, `DESIGN_NOT_APPROVED`, `CUSTOMIZER_INPUT_INVALID`.

---

## 4. Additions to the data model and states

New state machines (add to `packages/shared/src/machines/`, with exhaustive tests):
- **Library item:** `DRAFT → REVIEW → LIVE → PAUSED | REMOVED`; `REVIEW → REJECTED → DRAFT`. `LIVE` requires a valid license row.
- **Part fitment:** `UNVERIFIED → COMMUNITY → VERIFIED`; `VERIFIED → COMMUNITY` (on two fit reports); any → `MODIFICATION_REQUIRED` (reviewer action).
- **Request:** `OPEN → CLAIMED → DESIGN_SUBMITTED → BUYER_APPROVED → PRINTING → DELIVERED`; `DESIGN_SUBMITTED → CLAIMED` (rejected, revision count < 2); any pre-print → `CANCELED`.

---

## 5. Build order for this addendum

- **Slice A — Licenses and safety classes first.** `LicenseTerms`, `ModelLicense`, `safety_class` on parts, server-side enforcement, and the tests from sections 1.5 and 2.5 that cover them. Do this before any public catalog content exists.
- **Slice B — Customizers.** Reuse the Forge sandbox. Ship four starter customizers. Free-export allowance and the export footer. Image input path in the mesh service.
- **Slice C — Library.** Publish flow, moderation queue, downloads with license snapshot, collections, cost calculator with a shared golden fixture.
- **Slice D — Vehicles and fitment.** Importer for the chosen official source (behind an interface, with a fixture file for tests), `VehicleGroup`, fitment states, fit-first search.
- **Slice E — Parts and printing.** Part pages, print-order gating, fit disclaimer acknowledgement, reuse of the quote and checkout flow, fit-report flow and demotion rule.
- **Slice F — Request board and custom design.** Requests, claims, design versions, buyer approval, designer payouts (accrue only).

Each slice ends with a commit, green tests, and an update to `docs/progress.md`.

## 6. Open questions to record in `docs/decisions.md`

- Which official vehicle data source to use, and whether it covers the markets you launch in.
- The fit guarantee: what it covers, what it excludes, and who pays when a printed part does not fit. Draft only; counsel must review before it is offered.
- Whether designers can be unverified members, or must pass a review first.
- Whether `ALL-RIGHTS-RESERVED` downloads may be printed by a partner shop, or only by the buyer.
- Content policy for customizers that accept user images or text (for example, offensive text, trademarked logos, and personal photos of third parties). Write `docs/policy-content.md` before opening the image input.
- Whether to add a paid assistant for part identification later. If you add one, use the same author interface as the Forge, and keep it out of the fitment decision path. Fit data comes from verified records, never from a model's guess.
