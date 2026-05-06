# Changelog — pre-v2 (frozen historical snapshot)

> v2.0.0+ changes: see repo root [CHANGELOG.md](../../CHANGELOG.md)

All notable changes to LLM Wiki personal mode (v1.2 and earlier, MIT).

## [1.2.0] — 2026-05-05

### Added
- Sidecar config `~/.config/wiki/sidecar.json` with schema versioning + 7-day grace migration from v1.1's `~/.config/wiki-memory/vault-path` (G3, ADR 005)
- Lint Step 16: `_schema` version audit in `wiki/index.md` (structural check promoting step 14c to standalone step)
- Lint Step 17: `.memory.log` cross-reference audit — orphan log entries, orphan session files, timestamp monotonicity, duplicate detection (G4)
- Auto-compile native mode: `wiki-memory enable --auto-compile native` with cron + launchd schedulers, multi-layer recursion guard (Layer 1 env-var + Layer 2 inheritance verified by spike + Layer 3 per-session lockdir), daily cost-cap, fs-type refusal (NFS/SMB/sshfs/cloud-sync), F9 symlink defense, F10 session_id sanitization (G1, ADR 006)
- 6-layer test pyramid for prose-driven skills: L1 markdown lint + L2 schema invariants + L3 hash lockfile (drift detection) + L4 golden snapshots + L5 real-LLM gated (CI; $0.50/PR + $20/month aggregate cap) + L6 production smoke (G2)
- `references/` subdirs for `wiki-ingest` (3 files) and `wiki-lint` (3 files); SKILL.md trimmed to ~75-80 lines each (G6)
- ADR 005: sidecar schema-versioning + 7-day grace period + kubectl/AWS CLI lessons
- ADR 006: auto-compile architecture + spike result + threat model

### Changed
- `wiki-memory/SKILL.md` frontmatter: dropped `model:` field for cross-skill consistency (G5)
- `wiki-{ingest,lint}/SKILL.md` slimmed to ≤ 150 lines; deep specs moved to `references/` subdirs
- `tests/wiki-memory/integration/test-anti-trace.sh` scope expanded from `wiki-memory/` to full `skills/` + `tests/` (F14 fix); `spisak` and `second.brain` added to forbidden tokens
- `tests/wiki-memory/run-all.sh`: fixed pre-existing `((COUNTER++))` + `set -euo pipefail` early-exit bug (L1)

### Fixed
- Pre-existing `((COUNTER++))` arithmetic bug in `tests/wiki-memory/run-all.sh` under `set -e` caused test runner to exit after first test when counter started at 0 (L1 — surfaced during P06 validation)

### Hardened (red-team + validation 2026-05-05)
- 15 red-team findings applied (4 critical / 8 high / 3 medium); 4 validation decisions baked in (F3 hard-gate, 7-day grace, manual recovery, $20/month aggregate cap)
- Pre-impl spike for F3 confirmed `claude -p` env-var propagation; bonus discovery: `claude -p` requires explicit `--settings <file>` flag
- Trap-isolation fix in `cost-cap.sh` (no more silent `worker.lock` leak after cost_check)
- Walk-up symlink-loop guard added to `lib-vault-discovery.sh` step 4 (M2)
- File-level symlink rejection for `~/.config/wiki/sidecar.json` in `lib-vault-discovery.sh` (M3)

---

## [v1.1.0] — 2026-05-05

Schema v2: optional session memory capture, Q&A artifacts, incremental ingest.

### New skill: /wiki-memory (opt-in, off by default)

- 3 hooks: SessionEnd (auto-save), PreCompact (anti-loss flush), SessionStart (context priming)
- Pure bash + jq, zero Python/SDK dependencies
- Subcommands: enable, disable, status, flush, logs
- Scope flag: --scope global|project (default global)
- Off by default; opt-in via wizard Q11 cascade or `/wiki-memory enable`
- Auto-compile mode deferred to v1.2 (recursion guard + cost ceiling work needed)

### Schema v2 additions

- `raw/sessions/` — auto-captured transcripts (subset of raw/)
- `wiki/qa/` — Q&A artifacts with specialized v2 frontmatter (question, asked_at, confidence, answer_summary)
- `wiki/.state.json` — incremental ingest state (sha256-keyed, file_hash → ingested_at)
- `wiki/.memory.log` — append-only ops log
- `wiki/index.md` gains `_schema: 2` marker field on first v1.1 ingest

### Existing skill extensions

- `/wiki-query` gains `--save` flag → writes answer as `wiki/qa/<slug>.md`
- `/wiki-ingest` skips files with unchanged SHA256 (incremental); gains `--promote-qa <slug>` mode
- `/wiki-lint` adds steps 14 (qa/ orphan + frontmatter audit) and 15 (state.json drift); steps renumbered — total 15 steps (was 13)
- `/wiki` wizard adds Q11 cascade for memory opt-in with privacy warning

### Migration from v1.0.0 vaults

- Backwards compatible — no breaking changes, existing vaults work unchanged
- First `/wiki-ingest` after update sets `_schema: 2` + creates `wiki/.state.json`
- Missing dirs (`raw/sessions/`, `wiki/qa/`) auto-created; no data migration required
- Step-by-step: `npx skills update -g` → `/wiki` → `/wiki-ingest` → `/wiki-lint` → (optional) `/wiki-memory enable`

### Maintenance notes

- Hook scripts profile <100ms on 100-turn transcripts (verified 62ms)
- Recursion guard via `WIKI_MEMORY_INVOKED_BY` env var prevents hook re-entrancy
- Hook self-disable on missing SKILL.md (prevents orphan-hook PreCompact crashes)
- mkdir-lock pattern (no flock — macOS bash 3.2 compat)
- Schema doc bumped to v2 at `skills/wiki/references/wiki-schema.md`

---

## [v1.0.0] — 2026-05-05

Initial release.

### Slash commands

- `/wiki` — one-time setup wizard (creates vault structure + agent config)
- `/wiki-ingest` — process raw sources into structured wiki pages
- `/wiki-query` — answer questions across the wiki
- `/wiki-lint` — health-check the knowledge base

### Schema

- **YAML frontmatter** — `tags`, `aliases`, `sources`, `created`, `updated` on every wiki page
- **Citation Rules** — inline `(source: filename.md)` on entity/concept/synthesis pages (per-claim provenance)
- **Verification tag** — `[needs verification]` for unsourced claims (surfaced by lint)
- **Aliases (Obsidian wikilink resolution)** — `aliases[0]` matches H1 Title Case so `[[Title Case]]` resolves to `kebab-case.md`
- **Hot cache (`wiki/cache.md`)** — rolling ~500-word summary auto-managed by ingest (append) + lint (regen) for fast session startup

### Ingest workflow (`/wiki-ingest`)

- F1: Quote `sources:` YAML when filename contains commas
- F2: H1 must match wikilinks strictly (no parenthesized subtitles in H1)
- F3: When updating existing entity/concept, append source filename to `sources:` array
- F4: `## Entities Mentioned` entries use `- [[Wikilink]] — brief context` format
- A1: Auto-add `aliases: [<H1 Title Case>]` to all new entity/concept pages
- K1/K2: Inline citation + verification tag baked into ingest
- N1: Each ingest appends 1-line entry to `wiki/cache.md` under "Last N ingests"

### Lint audit steps (`/wiki-lint`)

1. Broken wikilinks
2. Orphan pages (no inbound links)
3. Contradictions
4. Stale claims
5. Missing pages (frequently referenced topics without dedicated pages)
6. Missing cross-references
7. Index consistency
8. Data gaps
9. Aliases consistency (entities + concepts must have `aliases[0] == H1`)
10. `[needs verification]` flags surfaced for follow-up
11. Missing inline citations on aggregator pages (heuristic, top-10 noise cap)
12. Sources-array completeness (cross-ref source mentions vs entity's `sources:` field)
13. Regenerate `wiki/cache.md` from `log.md` + frontmatter dates

### Wizard (`/wiki` skill)

- Generate `<vault>/.obsidian/app.json` with sane defaults (`newFileLocation: folder`, `newFileFolderPath: wiki/synthesis`, attachments → `raw/assets/`)
- Generate `<vault>/docs/obsidian-setup.md` checklist (Files & links settings, hotkeys, Web Clipper, common pitfalls, §6b aliases requirement)
- Generate `<vault>/wiki/cache.md` skeleton
- Input validation in `onboarding.sh`: reject vault names with shell-special chars
- Print "READ THIS first" callout pointing user to `docs/obsidian-setup.md` post-wizard
- Default vault name: `llm-wiki`
- Cursor config filename: `.cursor/rules/wiki.mdc`
- Multi-agent config support: Claude Code (CLAUDE.md), Codex (AGENTS.md), Cursor (.cursor/rules/wiki.mdc), Gemini CLI (GEMINI.md)

### Cross-project knowledge sharing

The wiki can serve as a shared knowledge layer for other Claude Code projects (1 wiki, N consumer projects). Add a `## Knowledge Base` section to any project's `CLAUDE.md` referencing your vault path — agent grounds its work against the wiki without requiring repeated context.

### Distribution

- Distribution via [`vercel-labs/skills`](https://github.com/vercel-labs/skills) ecosystem CLI (≥1.5.3)
- Install: `npx skills add Tedydev-web/llm-wiki-skills` (interactive — picks scope + skills) or `npx skills add Tedydev-web/llm-wiki-skills -g -y --all` (non-interactive one-liner for multi-machine automation)

### Branching contract

- `main` = release branch (tagged `v*`)
- Feature branches PR'd into main
- `npx skills update -g` tracks `main` — pulls latest release

### Maintenance notes

- **Future contributors:** review `.obsidian/app.json` and `obsidian-setup-template.md` diffs on every PR — these ship to user vaults and any change is user-visible
- **Tag immutability:** `v1.0.0` is frozen. Future fixes go to `v1.0.1`, etc.
