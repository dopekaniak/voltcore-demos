# Shapewright — product definition

**Tagline:** describe it, forge it, print it.

Shapewright is a web platform with three connected modes that share one account, one
credit wallet, and one library.

| Mode | What the user does | What they get |
| --- | --- | --- |
| **Forge** | Describes a mechanical or household part in plain language. | A *forge*: an interactive page with a 3D viewer, parameter controls, print checks, and STL / 3MF / STEP export. The part stays parametric. |
| **Generate** | Types a prompt (or uploads images). | An AI-generated mesh in two steps: a cheap untextured **preview**, then a textured **refine**. Also retexture and remesh. |
| **Print** | Uploads an STL/3MF/OBJ, or sends a forge export or generated model to print. | An automatic quote, configuration (material, colour, layer height, infill, supports, scale, quantity), a cart, checkout, and an order routed to a print partner. |

The brand name, logo, palette, and copy are original to this project. The name has not
had a trademark search; that is recorded as an open question in `docs/decisions.md`.

## Release 1 (this build)

- **Accounts:** magic-link sign-in, sessions, API keys with scopes, admin TOTP.
- **Credits:** wallet, append-only ledger, reserve → commit → release, monthly plan grants,
  credit packs, reaper for stale reservations.
- **Forge:** four bundled starter forges, the mock author (`FORGE_AUTHOR=mock`), sandboxed
  build (browser worker for previews, server worker for authoritative builds), viewer,
  parameter controls with clamping, checks panel, STL and 3MF export, STEP export on the
  server, versions, forking, "Send to print" gated on acknowledged failing checks.
- **Generate:** mock provider with preview and refine, image-to-3D, retexture, remesh;
  library with asset versions, mesh analysis on every version, signed downloads.
  A live adapter (Meshy) exists for text-to-3D preview and refine, used only when
  `PROVIDER_MODE=live` and a key is configured.
- **Print:** upload and quote in **estimate** mode (no slicer, see rule 6), validation and
  repair, configure, cart, Stripe test checkout (or mock), order and order-item state
  machines, mock partner routing, mock carrier tracking, transactional email.
- **Admin:** users, order board with status changes, job retry, credit adjustment, refunds
  with second approval, audit log viewer, reconciliation report.

### Estimate mode and ordering

`SLICER_MODE=estimate` is the only slicer mode until ADR-002b clears. Estimate quotes are
labeled **ESTIMATE** and **cannot be ordered** in production. For local demos and the
end-to-end suite, `ESTIMATE_ORDERS=allow-dev` lets an estimate quote reach checkout; the
environment schema refuses that value when `NODE_ENV=production` (ADR-010).

## Release 2

- Listings: creators enable printing on a public model and set a price per material;
  moderation approves listings; creator payouts accrue as pending (no live payouts).
- Public gallery and moderation tooling.
- Real slicer in production (`SLICER_MODE=real`) once ADR-002b is decided and reviewed by
  counsel.
- A live LLM forge author (`FORGE_AUTHOR=llm`) once its provider docs are read and an ADR
  records the rules.
- Developer API and outbound webhooks in full, and the Shop.

## Out of scope

These are deliberately not built and are not promised anywhere in the product:

- Teams and seats.
- Rigging and animation.
- A full CAD editor (the forge code view is read-only in Release 1).
- Real print-partner integrations (only `MockPartner` ships; no real partner is claimed).
- Live creator payouts (balances accrue only).
- Tax automation beyond Stripe Tax.
- A real slicer in any shipped service until ADR-002b is decided.

## Plans and credits (seed data, not code)

| Plan | Monthly credits | Notes |
| --- | --- | --- |
| Free | 100 | Monthly credits expire at period end. |
| Creator | 2,000 | Monthly credits expire at period end. API keys at 600 requests/min. |
| Studio | 10,000 | Monthly credits expire at period end. API keys at 3,000 requests/min. |

Purchased credit packs never expire. The Billing page and the Terms both say so.

## Feature modules after the core

The addenda in `docs/opus-prompts/` add modules 4–8 (customizers and library, fitment parts,
design copilot, industry parity, community library). They are built only after the Forge
core works, in the slice order each addendum lists. Progress is tracked in
`docs/progress.md`.
