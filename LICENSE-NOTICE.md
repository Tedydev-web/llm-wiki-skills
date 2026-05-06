# LICENSE-NOTICE

This repository contains two separately licensed components. Read the section that applies to the code you are using.

---

## 1. Personal mode — `apps/wiki-skills/` (v1.2)

**License: MIT**
Copyright 2026 Tedydev-web contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. See the MIT license text in `apps/wiki-skills/LICENSE` (or repo root `LICENSE`) for full terms.

**Scope:** All files under `apps/wiki-skills/`, `skills/` (symlink), and associated test files under `tests/wiki-memory/`.

This component predates any reading of third-party source code and is an independent clean-room implementation (see [ADR 001](docs/decisions/001-clean-room-implementation.md)).

---

## 2. Team mode — `apps/wiki-team/` + `packages/wiki-{schema,mcp,shared}/`

**License: PolyForm Noncommercial 1.0.0**
SPDX identifier: `LicenseRef-PolyForm-Noncommercial-1.0.0`
Full license text: <https://polyformproject.org/licenses/noncommercial/1.0.0/>

**Attribution (required by PolyForm-NC §4):**

> Code in `apps/wiki-team/` and `packages/wiki-{schema,mcp,shared}/` is derivative of `nduckmink/arkon` under PolyForm Noncommercial 1.0.0. Translated to TypeScript and substantially extended by Tedydev-web. See [ADR 009](docs/decisions/009-arkon-derivative-status.md) for full clean-room hygiene policy.

**Permitted use:** Non-commercial self-hosted deployment. You may run this software for your team, organization, or personal use at no charge, provided you do not provide it as a paid service to others.

**Forbidden use:** PolyForm-NC prohibits using this software to provide a commercial service (SaaS, hosted offering, or any service for which you charge a fee). Contact the upstream PolyForm-NC licensor for a commercial license.

**Relicensing restriction:** Code in `apps/wiki-team/` and `packages/wiki-*` MUST NOT be relicensed (to MIT or any other license) without a separate documented plan cycle (brainstorm + ADR + explicit user approval). This restriction is non-negotiable and exists to protect downstream users and upstream attribution requirements.

---

## 3. PDF extraction boundary — `packages/wiki-pdf-extract/`

**License: AGPL-3.0-only**
SPDX identifier: `AGPL-3.0-only`

`packages/wiki-pdf-extract/` wraps the `mupdf` npm package (MuPDF.js), which is licensed under AGPL-3.0. This package forms a typed API boundary isolating AGPL-licensed code from the rest of the `apps/wiki-team/` codebase.

**AGPL binary distribution obligation:** When distributing a compiled binary of `apps/wiki-team/` that bundles `packages/wiki-pdf-extract/` (and therefore `mupdf`), the resulting binary is AGPL-bound. You must make the complete corresponding source code available to recipients under AGPL-3.0 terms. The canonical source is this public repository.

**In-process use (self-hosted Docker):** Running the provided `docker compose up` setup does not constitute binary distribution — the AGPL obligation applies to distribution to third parties, not to running the software for your own team. See [ADR 009 §AGPL boundary](docs/decisions/009-arkon-derivative-status.md) for the full rationale.

---

## 4. Third-party runtime dependencies

Key runtime dependencies and their licenses (non-exhaustive; run `bun run licenses` for the full machine-generated list):

| Package | License | Notes |
|---|---|---|
| `better-auth` | MIT | Auth framework |
| `drizzle-orm` | Apache-2.0 | ORM |
| `hono` | MIT | HTTP framework |
| `bullmq` | MIT | Job queue |
| `mupdf` | AGPL-3.0 | PDF engine (AGPL boundary; see §3 above) |
| `mammoth` | BSD-2-Clause | DOCX extraction |
| `@mozilla/readability` | Apache-2.0 | URL content extraction |
| `next` | MIT | Admin frontend |
| `vitest` | MIT | Test runner (dev only) |
| `zod` | MIT | Schema validation |

Full dependency tree including transitive licenses: `bun run licenses` (generates `output/licenses.json`).

---

## 5. Summary

| Path | License | Commercial use allowed? |
|---|---|---|
| `apps/wiki-skills/` | MIT | Yes |
| `apps/wiki-team/` | PolyForm-NC 1.0.0 | No (self-host only) |
| `packages/wiki-schema/` | PolyForm-NC 1.0.0 | No |
| `packages/wiki-mcp/` | PolyForm-NC 1.0.0 | No |
| `packages/wiki-shared/` | PolyForm-NC 1.0.0 | No |
| `packages/wiki-pdf-extract/` | AGPL-3.0-only | No (AGPL + PolyForm-NC) |

*This notice was finalized in Phase 12 (P12) of the v2.0.0 release plan on 2026-05-06.*
