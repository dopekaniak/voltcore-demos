# ADDENDUM TO THE BUILD PROMPT — Module 8: Free STL community and model library

Attach after the base prompt and the other addenda. Build everything below as our own software. Do not integrate with, index, crawl, or copy from any site named here.

## 0. What the category is (from the "10 free STL websites" video, Oct 2026)

The nine sites named in the video fall into four groups. Build the features of each group, not the sites themselves.

- **Free model communities** (Thingiverse, Printables, MyMiniFactory, Cults3D): creators upload models with photos, a description, print notes, and a license. Users download free or buy, like, save to collections, comment, and remix.
- **Search aggregators** (Yeggi, STLFinder): one search box across many other sites' catalogs. These sites send users to the original page to download.
- **Engineering and CAD communities** (GrabCAD): models, CAD files, and projects shared by engineers, often with a challenge or contest format.
- **Paid asset marketplaces** (TurboSquid, CGTrader): licensed 3D assets sold per file, with creator payouts and royalty-free licensing.

## 1. Rules

1. **No crawling or indexing of third-party sites.** Yeggi-style aggregation means scraping other sites' catalogs. Do not build a crawler, a scraper, or a copy of any site's catalog. Search covers only models uploaded to our platform, plus any external source that offers an official feed or API whose terms permit indexing. If none is confirmed, there is no external index. Record the decision in `docs/decisions.md`.
2. **Original product and copy.** Do not reuse any site's name, logo, layout, categories, copy, badges, or ranking method. Write our own category names and our own UI.
3. **Licenses are per model and enforced on the server.** Reuse the License and attribution rules from the Customizer addendum. A model without a valid license cannot go public.
4. **Creators keep rights.** The uploader owns or is licensed to share the model. Takedown and counter-notice follow the content policy in `docs/policy-content.md`.
5. **Commercial sales follow the same money rules as the base prompt.** Server-side prices, idempotent orders, audited refunds, and creator payouts that accrue until a payout provider is integrated.

## 2. Features

### 2.1 Upload and publish
- Upload STL, OBJ, 3MF, and STEP (STEP is converted to STL for preview and stored as the source). Up to 25 files per model, with a total size limit set in config.
- Required fields: title, description, license, and at least one photo or render. Optional: print notes (material, layer height, supports, orientation), estimated print time (from the estimator), tags, and category.
- The platform runs `mesh /analyze` on every file and shows a printability badge (watertight, manifold, scale). A model that fails watertightness can still be published as "needs repair," with the warning visible.
- Publishing goes to a review queue. Reviewers check the license, the attribution, prohibited content, and trademark use in the mesh or photos.

### 2.2 Model page
- Gallery (photos and a 3D viewer), description, license block with attribution, print notes, file list with sizes, and print estimate for the default profile.
- Actions: download (free or paid), save to collection, like, comment, report, and remix (see 2.4).
- Creator block: username, follower count, and a link to all of their models.
- Download records feed the creator's stats. A signed URL is issued per download.

### 2.3 Search and browse
- One search box over our own catalog: title, description, tags, creator name, and file type. Use a trigram or full-text index in Postgres.
- Filters: license, free or paid, file type, print time range, material notes, category, and "printable now" (passes printability check).
- Sorts: relevance, newest, most downloaded, most liked. Ranking is a documented formula in config, not a copy of any other site's method.
- Browse pages per category and per tag. Empty results show suggested tags.

### 2.4 Remixes and derivatives
- A remix links a new model to its parent with a credit line showing the parent's title, creator, and license. The remix can only be published if the parent's license allows derivatives.
- Remix lineage shows a small tree on the model page.
- A test checks that a remix of a `CC-BY-ND-4.0` model is refused with `LICENSE_FORBIDS_DERIVATIVE`.

### 2.5 Collections, likes, and "save for later"
- Users create collections, add models, and reorder them. Likes and saves are separate counters.
- Saves are private unless the user makes the collection public.

### 2.6 Creator tools
- Creator dashboard: downloads, likes, saves, sales, pending payouts, and recent comments.
- Bulk upload from a folder, with a per-file license choice.
- Creator pages can be unlisted, so a creator can share a link without making the page searchable.

### 2.7 Paid models (second release)
- Price per model, a platform fee, and a creator share, recorded per order.
- Licenses for paid models are explicit: personal print only, commercial print, or commercial use with derivatives. Each buyer receives the license text in their order receipt.
- Creator share accrues as pending until the order is delivered and the refund window closes. No manual payouts from code.

### 2.8 Challenges (optional, later)
- Time-boxed contests with a brief, entry rules, and a judging step done by humans. Entries follow the same license and review rules. Prizes are out of scope for the first release.

## 3. Data model additions

- `Model` (id, creator_id, title, description, license_id, parent_model_id nullable, status `DRAFT|REVIEW|PUBLIC|UNLISTED|REMOVED|NEEDS_REPAIR`, price_minor nullable, print_notes jsonb, tags text[], category, created_at)
- `ModelFile` (model_id, role `SOURCE|PREVIEW|PHOTO|LOD`, format, storage_key, bytes, sha256, analysis jsonb)
- `Like`, `Save`, `Collection`, `CollectionItem` (position), `Comment` (model_id, author_id, body, status `VISIBLE|HIDDEN`)
- `Download` (user_id nullable, model_id, created_at, license_snapshot jsonb, signed_url_issued_at)
- `Follow` (follower_id, creator_id)
- `Report` (target_type, target_id, reporter_id, reason, status `OPEN|ACTIONED|DISMISSED`)
- `Challenge` (later)

## 4. API additions

- `POST /v1/models` (create draft), `POST /v1/models/:id/files` (presigned upload), `POST /v1/models/:id/submit` (to review)
- `GET /v1/models?q&category&license&free&print_time_max&sort&cursor`
- `GET /v1/models/:id`, `PATCH /v1/models/:id`, `DELETE /v1/models/:id`
- `POST /v1/models/:id/download` (returns a signed URL, records the download, enforces price and license)
- `POST|DELETE /v1/models/:id/like`, `POST|DELETE /v1/models/:id/save`
- `GET|POST /v1/collections`, `POST /v1/collections/:id/items`, `PATCH /v1/collections/:id/items/order`
- `POST /v1/models/:id/comments`, `POST /v1/reports`
- `POST /v1/models/:id/remix` (creates a draft linked to the parent, checks derivative license)
- `GET /v1/creators/:username`, `POST /v1/creators/:username/follow`
- `GET /v1/creator/stats?from&to`, `GET /v1/creator/payouts`

Admin: `GET /admin/review/queue`, `POST /admin/review/:id/decision` (approve, reject, needs-repair), `POST /admin/reports/:id/action`.

Error codes to add: `LICENSE_FORBIDS_DERIVATIVE`, `LICENSE_FORBIDS_PRINT`, `MODEL_NOT_PUBLIC`, `UPLOAD_LIMIT_EXCEEDED`.

## 5. Acceptance tests

- A model with no license cannot move from `DRAFT` to `REVIEW`.
- A `CC-BY-ND-4.0` model cannot be remixed; a `CC-BY-4.0` model can, and the remix shows the credit line.
- A model that fails watertightness is published as `NEEDS_REPAIR` with the warning shown; it is not blocked.
- Search over a 10,000-model seed returns the expected top result for a title match within 200 ms at p95.
- Likes and saves are idempotent: liking twice counts once.
- A private collection's models are not visible to other users, even by direct ID (404, not 403).
- A paid model download without a completed order returns `402` and creates no `Download` row.
- A creator's pending payout does not change when a refund is issued within the refund window; it reverses after the window closes only if the refund is final.
- The platform makes no outbound requests to any third-party catalog during search (a network-egress test confirms this).

## 6. Build order

1. **M8-A:** Model, files, upload, licensing checks, review queue.
2. **M8-B:** Model page, download with signed URLs, search and filters.
3. **M8-C:** Likes, saves, collections, comments, reports.
4. **M8-D:** Remixes and derivative checks.
5. **M8-E:** Creator pages, dashboard, stats.
6. **M8-F (second release):** Paid models, creator payouts (accrue only), licenses at checkout.
7. **M8-G (later):** Challenges.

Each slice ends with a commit, green tests, and an update to `docs/progress.md`.

## 7. Open questions for `docs/decisions.md`

- Whether any external index will ever exist, and under what official agreement.
- Whether free models require a sign-in to download (recommended: yes, so downloads can be counted and abuse limited).
- Whether to allow `ALL-RIGHTS-RESERVED` models on the free tier (recommended: personal print only, no remix).
- The ranking formula for search, documented and reviewed for abuse (for example, like farming).
