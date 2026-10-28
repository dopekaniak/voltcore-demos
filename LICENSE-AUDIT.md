# License audit

Every new top-level dependency gets a line here and a reason in `docs/decisions.md`.
Licenses were read from each package's published metadata unless noted.

## Project

Shapewright source in this repository: proprietary, all rights reserved (no license file is
granted to third parties). Starter forges in `packages/forge-kit/examples/` are original
work and are released under MIT so users may fork them.

## Key dependencies

| Package | Version | License | Use | Notes |
| --- | --- | --- | --- | --- |
| partforge | 0.166.0 | MIT | Forge geometry framework (ADR-003) | Verified from npm metadata on 2026-10-28. Used as a dependency; its `LICENSE`/copyright notice is preserved in `node_modules` and reproduced in the web app's third-party notices page. No partforge source is copied into this repo. |
| manifold-3d | 3.5.x | Apache-2.0 | Mesh kernel (via partforge) | NOTICE requirements apply on redistribution. |
| replicad | 0.23.x | MIT | B-rep kernel wrapper (via partforge) | |
| replicad-opencascadejs | 0.23.x | MIT (package) | OpenCASCADE WASM (via partforge) | The bundled OpenCASCADE Technology is LGPL-2.1 with the OCCT exception. Used unmodified, server side only for STEP. Open question 5 in `docs/decisions.md`. |
| three | 0.184.x | MIT | Viewer | |
| dompurify | 3.x | MPL-2.0 OR Apache-2.0 | via partforge | Chosen under Apache-2.0. |
| sharp / @img/sharp-libvips | 0.35.x | Apache-2.0 / LGPL-3.0-or-later | transitive (via partforge dev tooling) | Not used by our code; LGPL libvips is dynamically loaded. Re-check if it appears in a production bundle. |

Other transitive dependencies of partforge (MIT, ISC, BSD-2-Clause, 0BSD): @gltf-transform/*,
fflate, marked, meshoptimizer, opentype.js, paper, pngjs, flatbush, flatqueue, fast-xml-parser,
esbuild-wasm, and others listed by `pnpm licenses list`.

## Prohibited

- PrusaSlicer, CuraEngine (AGPL-3.0, verified 2026-10-28) and Bambu Studio (reported
  AGPL-3.0): not linked, bundled, or called by any shipped service (rule 6, ADR-002b).

## Added per slice

Entries below are added as dependencies land.

### Slice 2 — Foundation

| Package | License | Reason (see decisions) |
| --- | --- | --- |
| turbo, typescript, vitest, eslint, typescript-eslint, prettier, tsx, tsup | MIT / Apache-2.0 (typescript) | Tooling (ADR-018) |
| zod | MIT | Contracts and env validation (ADR-011) |
| uuid | MIT | UUIDv7 ids (ADR-014) |
| prisma, @prisma/client | Apache-2.0 | ORM and migrations (stack) |
| fastify, @fastify/cookie, @fastify/rate-limit | MIT | API (ADR-001) |
| ioredis | MIT | Redis client |
| bullmq | MIT | Job queues (ADR-004) |
| fast-check | MIT | Property tests (ADR-005) |
| yaml | ISC | openapi.yaml writer (ADR-011) |
| fastapi, python-multipart | MIT / Apache-2.0 | Mesh service (ADR-002) |
| uvicorn, httpx, numpy, scipy, networkx | BSD-3-Clause | Mesh service runtime and tests |
| trimesh | MIT | Mesh analysis and repair (ADR-002) |
| pytest | MIT | Python tests |

### Slice 3 — Accounts and credits

| Package | License | Reason |
| --- | --- | --- |
| nodemailer | MIT-0 | SMTP email to Mailpit and production relays (ADR-017) |
