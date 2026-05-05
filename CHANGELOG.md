# Changelog

All notable changes to LLM Wiki.

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
