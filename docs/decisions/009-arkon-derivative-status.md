---
adr: 009
title: Arkon-derivative status and PolyForm-NC license inheritance
status: accepted
date: 2026-05-06
---

# 009 — Arkon-derivative status (PolyForm-NC inherited)

## Context

The `wiki-team` application (`apps/wiki-team/` + `packages/wiki-*/`) is derived from
`nduckmink/arkon` (HEAD of `main`, shallow clone `/tmp/arkon-study/`, deleted post-scout).
Arkon's license is **PolyForm Noncommercial 1.0.0**.

The brainstorm selected Path E1+E2: read arkon source, understand design, rewrite in
TypeScript from first principles. Per copyright precedent (*Whelan Associates v. Jaslow
Dental Lab.*, 1986), translation of a copyrighted work — including a language port of
non-trivial software — constitutes a **derivative work**. The user acknowledged this before
any source reading began.

Brainstorm Legal / IP acknowledgment (verbatim):

> "Resulting TS code is **derivative of arkon** under PolyForm Noncommercial 1.0.0.
> Must retain attribution: 'originally derived from `nduckmink/arkon` under PolyForm
> Noncommercial 1.0.0'. License of our final code: **PolyForm Noncommercial 1.0.0**
> (cannot relicense to MIT). Cannot claim '100% Tedydev-web original' — branding =
> 'Tedydev-web's team-mode adaptation, derived from arkon'.
> Open-source non-commercial users (D1 vision) ✓ permitted under PolyForm-NC ✓."

## Decision

**`apps/wiki-team/` and all `packages/wiki-*/` packages are licensed under PolyForm
Noncommercial 1.0.0, as derivative works of `nduckmink/arkon`.**

`apps/wiki-skills/` (personal mode, bash+jq, predates arkon reading) remains MIT.

### Hard constraints

1. **Code in `apps/wiki-team/` and `packages/wiki-*/` MUST NOT be relicensed without a
   separate brainstorm + plan cycle.** Any relicense proposal (MIT, Apache-2, AGPL, BSL,
   commercial) requires explicit legal review and user sign-off before implementation.

2. **AGPL note:** MuPDF.js (`mupdf` npm package, embedded in the BullMQ worker per
   phase-06) makes `apps/wiki-team/` binary distribution AGPL-bound. Acceptable per D1
   (open-source non-commercial) — users receiving a compiled binary of `wiki-team` are
   entitled to source under AGPL. The AGPL obligation does not extend to `apps/wiki-skills/`
   (MIT, no MuPDF.js dependency).

3. **No SaaS resale.** PolyForm-NC 1.0.0 §1.3 prohibits offering arkon-derived software
   as a commercial service. This project's D1 vision (open-source non-commercial, BYO-host)
   is compliant. Any future pivot to paid SaaS requires a separate commercial license from
   `nduckmink/arkon` upstream.

4. **Attribution required.** Every release MUST carry: _"Originally derived from
   `nduckmink/arkon` under PolyForm Noncommercial 1.0.0."_
   Location: `LICENSE-NOTICE.md` at repo root (placeholder created in P00, finalized P12).

### Forbidden tokens in shipping code

The following MUST NOT appear verbatim in `apps/wiki-team/` or `packages/wiki-*/`
(anti-trace hygiene; source: scout report §Anti-trace risk surface):

**Class / type names:**
`ResolvedIdentity`, `AssistantTurn`, `ProviderRegistry`, `ProgressTracker`,
`AgentState`, `PolicyDecision`, `ProviderType`, `ScopeType`, `WorkspaceRole`,
`MCPAuthService`

**Magic constants:**
`MAX_DOCUMENT_CHARS` (= 200 000), `MAX_INDEX_PAGES_LISTED` (= 200),
`TOP_K_RELEVANT` (= 8), `MAX_STEPS` (= 50), `INITIAL_EXCERPT_CHARS` (= 30 000),
`WARN_STEPS` (= 40)

**Permission verbs / resource names (exact set):**
`doc:read:own_dept`, `doc:read:all`, `wiki:write:own_dept`,
`org:departments:manage`, `workspace:view:all`

**Page-type 4-tuple (exact combination):** `entity` + `concept` + `topic` + `source`

**Reserved slugs:** `_index`, `_log`

**Function names:**
`apply_scope_filter`, `build_document_filter`, `regenerate_index`,
`compile_source_into_wiki`, `compile_source_with_agent`,
`extract_wikilinks`, `refresh_links`

**Exception list** — the following ARE allowed (SPDX identifiers, not code):
- The string `PolyForm-NC-1.0.0` in LICENSE files and SPDX headers
- The word `arkon` in `LICENSE-NOTICE.md`, ADR 009, and the anti-trace test exclude list
- The word `arkon` in `CHANGELOG.md` under the v2.0 attribution entry
- The string `nduckmink` in attribution notices only

### Anti-trace audit scope

The canonical audit script (authored by P01) is:
```
bash tests/wiki-team/integration/test-anti-trace.sh
```
It excludes: `docs/decisions/009-*.md`, `LICENSE-NOTICE.md`, `CHANGELOG.md`,
`tests/wiki-team/integration/test-anti-trace*`, and fixture files.

Until P01 ships the script, the manual equivalent is:
```bash
grep -rwF -i 'arkon\|nduckmink\|Sahara' \
  apps/wiki-team/ packages/ \
  --include='*.ts' --include='*.json' --include='*.md'
```
Expected: **0 hits** in shipping code outside the exception paths above.

### CONTRIBUTING.md PR checklist line (proposed)

> - [ ] `bash tests/wiki-team/integration/test-anti-trace.sh` exits 0 (no arkon/nduckmink
>       references in shipping code outside allowed attribution paths)

## Consequences

**Positive:**
- Legal posture is explicit, documented, and non-deniable; future contributors cannot
  accidentally relicense.
- PolyForm-NC permits non-commercial open-source use — the primary audience.
- Attribution is minimal and concentrated in two files (`LICENSE-NOTICE.md`, `CHANGELOG.md`).

**Negative:**
- Cannot flip to MIT if the project later attracts commercial interest without negotiating
  an upstream license from `nduckmink/arkon`.
- AGPL via MuPDF.js means binary distribution carries AGPL source disclosure obligation.
  Docker images count as distribution — ship `Dockerfile` with `ARG INCLUDE_SOURCE=true`
  or document source URL prominently.

**Neutral:**
- PolyForm-NC 1.0.0 does not require contribution assignment — contributors retain
  copyright on their additions, but the base work's license floor cannot drop below NC.

## Alternatives rejected

- **Relicense as MIT immediately:** Not legally possible without upstream consent. Rejected.
- **Claim clean-room (100% original):** Path E1+E2 (read source) was chosen explicitly;
  clean-room claim would be false. Rejected.
- **Fork publicly under arkon's name/brand:** Would confuse project identity. Rejected.

## References

- Brainstorm Legal/IP section: `plans/reports/brainstorm-260506-0807-arkon-team-mode-fork-port.md`
- Scout anti-trace surface: `plans/reports/scout-260506-0807-arkon-source-walk.md` §Anti-trace risk surface
- PolyForm Noncommercial 1.0.0: https://polyformproject.org/licenses/noncommercial/1.0.0/
- ADR 001: Clean-room implementation (personal mode; predates arkon reading)
- ADR 007: MuPDF.js AGPL note
- `LICENSE-NOTICE.md`: attribution placeholder (finalized P12)
