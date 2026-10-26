# ADDENDUM TO THE BUILD PROMPT — Module 6: Design Copilot (upgrades the Forge)

Attach after `opus-workable-prompt.md`. Module 6 extends the Forge from section 3 of that prompt. Everything in the base prompt still applies: original brand and code, official docs only, sandboxed AI-written code, server-authoritative money, and "do not stop to ask."

Module 6 targets the same category as Loftsmith: a beginner-friendly tool that turns a description, and optionally a photo, into a printable parametric part, checked against a printer profile. Build it as an upgrade to the Forge, not a second product. Reuse the Forge code, the sandbox, the `verify` checks, and the export pipeline.

---

## 0. Rules for this module

1. **Original product, original copy.** Do not copy the wording, layout, screenshots, pricing page, or onboarding of any other product. The features below are described by function. Write all UI copy yourself.
2. **Dimensions are measured or assumed, and the UI says which.** A dimension taken from a photo is valid only after the user has calibrated it against a known measurement. Any dimension the system guesses is labeled "assumed" and must be confirmed before export. The copilot never silently invents a dimension it was not given.
3. **Engineering estimates are estimates.** Stress and tip-over checks are simple calculations. Label them "estimate, not a certified load test" wherever they appear. Never state that a part is safe or will hold a load.
4. **Prohibited items are blocked on the server.** Firearms, firearm parts, and weapon accessories are not designed or printed on this platform. Block them on text input, on uploaded images, and on copilot edit requests. Test all three paths. Write the list in `docs/policy-content.md`.
5. **Ownership is stated and stored.** Users own what they design. The Terms say so, and paid plans include commercial use. Record the license snapshot on every export. The Terms text is a draft for counsel.

---

## 1. Feature: describe a part, then refine it by conversation

- **Start from text.** The user describes a part in one sentence ("bracket for a 60 mm fan"). The copilot writes the parametric model through the existing `FormAuthor` interface from the base prompt.
- **Follow-up edits as messages.** The user types a change ("make the holes 4 mm larger" or "add a lip on the left edge"). The copilot edits the model code and creates a new forge version. The UI shows a short diff of the parameters and features changed. The user accepts or reverts. Each accepted edit is a version.
- **Edits change code, not meshes.** Never edit the output mesh directly. Every change goes through the model source, so the design stays parametric and re-buildable.

---

## 2. Feature: region edits (select an area, describe the change)

- The user clicks or circles an area on the 3D viewer or on a 2D screenshot, then describes the change.
- **Map the selection to a feature, not to triangles.** The viewer returns the picked face. The worker maps that face to the nearest named feature in the model (each feature the author writes carries an `id` and a bounding box). The copilot receives: the feature `id`, its parameters, the user's words, and the model code. It edits only that feature's code.
- **If the mapping is ambiguous** (two features overlap the selection), the copilot shows a short list of candidates and the user picks one. Do not guess.
- **Model contract addition:** every feature in `build()` is named (`features: { lid_snap: ..., base: ... }`). Starter forges and any AI-written forge must follow this. A forge without named features cannot take region edits; the UI says so and offers a plain text edit instead.
- Acceptance: a circled area on the rim of a planter maps to the `rim` feature, and the resulting version changes only the `rim` block. A test checks that unrelated features' code is byte-identical after the edit.

---

## 3. Feature: photo calibration

Use this flow when the user needs a real-world dimension from a photo (for example, a fan, a battery, or an existing broken part):

1. The user uploads a photo through the normal upload pipeline (quarantine, type scan, size limit 20 MB, strip EXIF location data).
2. The user draws a line across a known edge in the photo and enters its real length in mm.
3. The server computes the scale factor from the line and the entered length. It stores a `Calibration` row: photo asset ID, line endpoints in image pixels, real length, computed mm-per-pixel, and a `source` of `USER_MEASURED`.
4. Other dimensions the user measures on the same photo use that calibration. Each dimension stored in the model gets `source: 'measured'` and a reference to the calibration row.
5. If the user has not calibrated, the copilot asks for a measurement. It does not estimate the scale from the image content.

Build the calibration math as a pure function in `packages/forge-kit` with tests: a known pixel length, a known mm length, and expected scale; a zero-length line is rejected; a line whose endpoints are outside the image is rejected.

Acceptance: a photo of a 60 mm fan calibrated with a 60 mm edge produces a 60 mm model dimension marked `measured`. Changing the calibration length to 58 mm updates the dimension to 58 mm and marks dependent features as needing a rebuild.

---

## 4. Feature: printer profiles

- Profile contains: bed dimensions (x, y, z in mm), nozzle diameter, and the list of materials the profile is validated for.
- **Build your own profile table** from each manufacturer's published bed specifications. Record the source URL and the retrieval date in `packages/forge-kit/profiles/README.md` for each row. Include a **Generic FDM** profile with a user-entered bed size, and make it the default.
- Named printer profiles are factual compatibility labels. Use the model name as plain text in a dropdown. Do not use any manufacturer's logo, color scheme, or product photo.
- The active profile drives the bed-fit check, the wall-thickness minimum, and the overhang angle default. Changing the profile re-runs `verify`.

---

## 5. Feature: printability checks (panel on the forge page)

Run these on every build. Show each as pass, warn, or fail with a plain-language message and the measured value:

- **Bed fit:** bounding box against the active profile, in the orientation the user chose.
- **Wall thickness:** minimum wall against the profile's minimum, with the location shown in the viewer as a highlight.
- **Overhangs:** faces steeper than the profile's overhang angle (default 45°), highlighted in the viewer, with the percentage of area.
- **Manifold and watertight:** from the mesh analysis service.
- **Layer and slicing sanity:** the mesh slices into layers without empty layers or self-intersections (run in the mesh service).
- **Engineering estimates (optional panel, labeled as estimates):** a simple bending-stress estimate for a named load on a named feature, and a tip-over estimate for a standing part given its base and center of mass. Each shows the formula used and the assumptions. Both carry the text "estimate, not a certified load test."

A warning never blocks export. A fail on bed fit or manifold status does block "Send to print" until the user fixes it or acknowledges it.

---

## 6. Feature: test print

- The user selects a feature or drags a plane to cut a small section (a snap-fit, a thread, a hinge).
- The worker cuts the section, runs the same `verify` checks on the section, and exports it as STL with the name `test-section`.
- The export page labels the file as a test section and links it to the parent forge version, so the user knows it is not the full part.
- Acceptance: a snap-fit feature cut as a test section exports a file whose bounding box matches the feature's bounding box within 0.05 mm, with the "test section" label.

---

## 7. Export and plans

- **Exports:** STL and 3MF (multi-part laid out on a bed) on all paid plans; STL on free. STEP is a Pro feature and is marked beta in the UI until the STEP path has tests for every starter forge.
- **Local versus server work:** sliders, checks, and downloads of existing exports should run in the browser or worker without charging credits, following the Forge rule from the base prompt. Charge credits only for AI authoring and copilot edits.
- **Credits:** define the cost table in seed data. Give free users a small starter balance that resets monthly or once, and state which. Do not copy any other product's allowance; set your own numbers in config.
- **Commercial use:** paid plans include commercial use of designs and prints. Free plans are personal use only. Show this on the pricing page and store the plan's terms with each export.

---

## 8. Data model additions

- `Calibration` (id, owner_id, photo_asset_id, line_px jsonb, real_length_mm, mm_per_px, created_at)
- `ForgeFeature` (forge_version_id, feature_key, code_range jsonb, bbox_mm jsonb) — written by the build step from the named-feature contract
- `CopilotEdit` (id, forge_version_id, user_message, target_feature_key nullable, diff jsonb, status `PROPOSED|ACCEPTED|REJECTED`, credits_reserved, created_at)
- `PrinterProfile` (id, name, bed_mm jsonb, nozzle_mm, validated_materials text[], overhang_default_deg, wall_min_mm, source_url, retrieved_on, is_generic bool)
- `ExportRecord` (id, forge_version_id, format, plan_code_at_export, license_snapshot jsonb, is_test_section bool, created_at)

---

## 9. API additions (`/v1`)

- `POST /v1/forges/:id/copilot-edits` (body: `message`, optional `target_feature_key`) → `CopilotEdit` with a proposed diff. Charges credits on proposal, releases on rejection.
- `POST /v1/copilot-edits/:id/accept` | `POST /v1/copilot-edits/:id/reject`
- `POST /v1/forges/:id/region-edits` (body: `face_id` or `screenshot_point`, `message`) → resolves to `target_feature_key` or returns `candidates[]` for the user to pick.
- `POST /v1/calibrations` (body: `photo_upload_id`, `line_px`, `real_length_mm`) → `Calibration`
- `GET /v1/printer-profiles`, `PUT /v1/forges/:id/printer-profile`
- `POST /v1/forges/:id/test-sections` (body: `feature_key` or `plane`) → export job with `is_test_section=true`
- `GET /v1/forges/:id/checks?profile_id=` → the check results panel

Error codes to add: `PROHIBITED_ITEM`, `CALIBRATION_REQUIRED`, `CALIBRATION_INVALID`, `FEATURE_AMBIGUOUS` (with candidates), `FORGE_NOT_FEATURED` (the forge has no named features for region edits), `ESTIMATE_NOT_CERTIFIED` (a warning code, not a blocker).

---

## 10. Content policy enforcement (server-side, three paths)

- **Text:** a deny-list of prohibited item terms, plus the author's own refusal. The copilot refuses with `PROHIBITED_ITEM` and a short, neutral reason. It does not offer a workaround.
- **Image:** the upload pipeline runs an image classifier for prohibited item types before a photo can be used for calibration or as a reference. A flagged image is quarantined and sent to the moderation queue, not silently dropped.
- **Edits:** the copilot's proposed edit is checked against the same deny-list and classifier before it is shown to the user. A prohibited edit is refused and the refusal is logged.
- A test submits a prohibited prompt, a prohibited image, and a prohibited edit, and expects `PROHIBITED_ITEM` on each.

Log every refusal with a hashed user ID, and review refusals weekly. Record the list and the review process in `docs/policy-content.md`.

---

## 11. Acceptance tests

- Describe a 60 mm fan bracket → forge builds with named features → bed-fit and wall checks run → exports STL.
- Region edit on a circled planter rim changes only the `rim` feature block (byte-identical check on other features).
- Photo calibration with a 60 mm reference edge yields a `measured` 60 mm dimension; recalibrating to 58 mm updates it and marks dependents for rebuild.
- A zero-length calibration line is rejected with `CALIBRATION_INVALID`.
- Switching from the generic profile to a 180 mm-bed profile re-runs bed-fit and flips a 200 mm part from pass to fail.
- A test section of a snap-fit exports with bounding box within 0.05 mm of the feature and the test-section label.
- Engineering estimate panel shows the formula and the "estimate, not a certified load test" text on every render.
- Prohibited prompt, prohibited image, and prohibited edit each return `PROHIBITED_ITEM`.
- A free-plan export has no commercial-use terms in its `license_snapshot`; a paid-plan export does.

---

## 12. Build order

- **Slice M6-A — Named features and region edits.** Feature contract in the model format, feature map in the build step, region-edit endpoint, candidate picker for ambiguous picks, and the byte-identical test.
- **Slice M6-B — Copilot edits.** Chat-driven edits with diff, accept and reject, credit reservation on proposal, versioning.
- **Slice M6-C — Calibration and profiles.** Calibration math with tests, `measured` vs `assumed` dimension source, printer profile table with sources, generic default.
- **Slice M6-D — Checks panel and engineering estimates.** Overhang, wall, bed fit, manifold, layer sanity; estimate panel with the required labels.
- **Slice M6-E — Test sections and export records.** Section cut, test-section label, export records with license snapshot.
- **Slice M6-F — Content policy.** Three-path enforcement, refusal logging, policy document. Do this before opening M6-C's image upload to users, not after.

Each slice ends with a commit, green tests, and an update to `docs/progress.md`.

---

## 13. Open questions to record in `docs/decisions.md`

- Which image classifier for prohibited items, and its false-positive rate on the launch image set. Test on a labeled set you build yourself before enabling it.
- Whether the free plan's starter credits reset monthly or are one-time.
- Whether test sections count against credits. Recommended: no, since they are cut from an existing version.
- The exact wording of the estimate disclaimer and the commercial-use terms, reviewed by counsel before launch.
- Whether the STEP export moves out of beta only after the starter forges pass a STEP round-trip test in a CAD tool you have licensed for testing.
