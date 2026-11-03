# ADDENDUM TO THE BUILD PROMPT — Module 7: Industry parity features (no vendor integrations)

Attach after the base prompt and the other addenda. Build the features below as our own software. Do not integrate with, resell, or depend on any of the ten companies listed in section 1.

---

## 0. Rules

1. **Features, not vendors.** Build each capability as a generic feature of our platform. Do not call any vendor's cloud, API, or app, do not sign in to any vendor account, and do not use vendor names, logos, or product names in our UI. Refer to vendor-style features by function only ("slicer," "print queue," "on-demand service").
2. **Parity is a checklist, not a copy.** Each feature below is verified against our own acceptance tests, not against any competitor's screens or behavior.
3. **Licenses for slicing engines are a gate, not an assumption.** Several open-source slicers are copyleft (for example, PrusaSlicer, Bambu Studio, and CuraEngine are published under AGPL-family licenses; confirm each license from its own repository before use). Running a copyleft program as a separate process still has obligations if you modify it or expose it over a network. Do not ship any copyleft slicer until ADR-M7-1 is written and counsel has reviewed it. Until then, the slicer runs as one of: (a) a fixed-function estimator in our own code, labeled "estimate," or (b) a slicer you build or license under a permissive license. Default to (a).
4. **Market facts are verified before they go in the UI.** Any claim about a vendor, a printer, or a material (bed size, supported materials, certifications) comes from that vendor's published documentation, with the URL and retrieval date in `docs/research.md`. If you cannot verify it, leave it out.

---

## 1. The ten companies this module is modeled on (function reference only)

Confirm this list with the user before building. The list is chosen for market presence in desktop, prosumer, professional, and industrial printing. One search for a current ranking returned no usable source, so the selection is a judgment call.

| # | Company | Primary segment | Feature area it informs |
|---|---|---|---|
| 1 | Stratasys | Industrial polymer | Print management, production service |
| 2 | 3D Systems | Industrial and on-demand parts | Quoting, on-demand production |
| 3 | Formlabs | Professional resin and powder | Desktop-to-production workflow, on-demand service |
| 4 | HP | Industrial powder (Multi Jet Fusion) | Production batching, partner networks |
| 5 | EOS | Industrial metal and polymer | Process and material parameter libraries |
| 6 | Markforged | Industrial composites and metal | Cloud print management, parameter profiles |
| 7 | Bambu Lab | Consumer and prosumer FDM | Slicer, model platform, cloud print, AI model generation |
| 8 | Prusa Research | Prosumer FDM | Open slicer, open model platform, printer web interface |
| 9 | Creality | Consumer FDM | Slicer, model platform, cloud print |
| 10 | UltiMaker | Professional FDM | Slicer, print management |

Verify each row's feature claims against the vendor's own documentation before writing UI copy. Known areas to check: Stratasys' slicer and print-management software; 3D Systems' online quoting and on-demand parts; Formlabs' desktop software and on-demand print service; Markforged's cloud print-management software; Bambu Lab's slicer, model platform, and AI model generator; Prusa's open-source slicer and model platform; Creality's cloud and slicer software; UltiMaker's slicer and print-management software.

---

## 2. Feature areas to build

### 2.1 Slicer-style print preparation (feature area 1, 7, 8, 9, 10)
- **Printer profile + material profile + print profile** as three separate, combinable records. Profiles are data in the database, versioned, and shareable within the platform.
- **Print profile fields:** layer height, wall count, top and bottom layers, infill pattern and density, supports (type, angle, density), brim or raft, print speed and acceleration limits, temperature ranges per material, cooling. Keep field names generic.
- **Preview:** estimated time, material mass, and a layer-by-layer preview. In MVP, this is the estimator from section 2.1 of the base prompt; swap in a real slicer only after ADR-M7-1 clears.
- **Profile sharing:** users can publish a profile with a model, like the model-page recommended settings in community model sites. A published profile records its author and license.
- **Acceptance:** the same model, profile, and printer always produce the same estimate (determinism test). A profile edit bumps the profile version and does not change prior quotes.

### 2.2 Print queue and fleet management (feature area 1, 6, 7, 10)
- The platform tracks **our own** printers (or printers a shop partner registers) as `PartnerPrinter` rows, with bed size, materials loaded, state, and a queue.
- **Queue:** ordered jobs per printer, with drag-to-reorder, a planned start time, and an estimated finish time from the print estimate.
- **Status:** `QUEUED → PRINTING → POST_PROCESSING → QC → DONE`, with `FAILED` and `PAUSED` branches. Every change writes a status event.
- **Remote printer control is out of scope for the MVP.** Printer status is reported by the operator or by a vendor-neutral agent running on the printer's network. Do not build control commands (start, stop, temperature) in the first release. If later needed, implement them only through a documented, open, local protocol, with a safety interlock requirement written in `docs/security.md`.
- **Acceptance:** a queued job cannot start on a printer whose profile does not include the job's material; a printer marked `MAINTENANCE` is skipped by routing.

### 2.3 Production and on-demand service (feature area 2, 3, 4, 5)
- **Quoting:** online quote from the upload pipeline (base prompt section 5), with the same engine for every material and profile.
- **Production batching:** group compatible items (same material, layer height, and profile) into one build plate when the sum of their footprints fits. The batching algorithm is a pure function with tests: it never exceeds bed size, never mixes incompatible materials, and reports unbatched items with a reason.
- **Industrial materials:** material records carry a datasheet link (from the material supplier's own documentation) and a list of process parameters. Do not include mechanical property numbers unless the supplier's datasheet supports them; record the datasheet and version.
- **Acceptance:** a batch of 5 identical 50 mm cubes on a 200 mm bed produces one plate with all 5; a sixth item in a different material is left unbatched with reason `MATERIAL_MISMATCH`.

### 2.4 Parameter libraries (feature area 5, 6)
- A material parameter set is a versioned record (material, machine profile, and a set of named parameters with units and valid ranges). Editing a set creates a new version.
- Ops can compare two versions side by side. A test confirms that a quote references the version it was made with.

### 2.5 Model library with print information (feature area 7, 8, 9)
- Each model page shows: recommended print profile (or "none"), estimated print time and material for the default profile, license, and attribution. These feed the Library module from the Customizer addendum.

### 2.6 Printer web and status interface (feature area 8, 9)
- A status page per printer (state, current job, temperatures only if the operator's agent reports them) with a read-only view. Authentication and rate limits as in the base prompt.

---

## 3. What this module does not do

- No integration, login, or data exchange with any of the ten vendors.
- No vendor cloud sync, no vendor model-library import, and no use of their profiles, datasheets, or material names beyond what their public documentation states and we cite.
- No remote machine control in the first release.
- No claims that a material or printer is certified for any industry, unless the claim comes from a certificate the operator uploads and that is verified by ops.

---

## 4. Slice order

1. **M7-A:** Profile model (printer, material, print profiles) with versioning and determinism tests.
2. **M7-B:** Fleet registry, queue, status events, routing rules and tests.
3. **M7-C:** Batching algorithm with its tests, plus parameter library versions.
4. **M7-D:** Profile sharing on model pages and the status page.
5. **M7-E:** ADR-M7-1 (slicer license decision) written and reviewed; only then consider a real slicer.

Each slice ends with a commit, green tests, and an entry in `docs/progress.md`.

---

## 5. Open questions for `docs/decisions.md`

- Confirm the ten companies (section 1). Replace any row the user rejects.
- ADR-M7-1: which slicer engine, and under what license terms.
- Whether a printer agent is built for our own use only, or offered to shop partners.
- Whether industrial material datasheets can be shown to buyers, given each supplier's terms.
