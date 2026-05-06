# Wiki Schema

**Schema v2 (2026-05-05) — backwards compatible with v1 vaults.**

Canonical rules for LLM-maintained knowledge base wikis. This is the single source of truth — agent config templates pull from this document.

## Vault Layout

Three top-level directories, three roles:

- **raw/** — immutable source documents. The LLM reads from here but NEVER modifies these files.
- **wiki/** — the LLM's workspace. Create, update, and maintain all files here.
- **output/** — reports, query results, and generated artifacts go here.

Full vault tree:

```
vault-root/
├── raw/
│   ├── assets/                        # downloaded images (see Image Handling)
│   ├── <clipped-articles>.md          # web-clipped or imported source docs
│   └── sessions/                      # NEW v2: auto-captured Claude Code transcripts
├── wiki/
│   ├── sources/                       # one summary page per ingested source
│   ├── entities/                      # pages for people, organizations, products, tools
│   ├── concepts/                      # pages for ideas, frameworks, theories, patterns
│   ├── synthesis/                     # comparisons, analyses, cross-cutting themes
│   ├── qa/                            # NEW v2: Q&A artifacts from /wiki-query --save
│   ├── index.md                       # master catalog, updated on every ingest
│   ├── log.md                         # append-only chronological record
│   ├── cache.md                       # rolling ~500-word hot summary
│   ├── .state.json                    # NEW v2: incremental ingest state
│   └── .memory.log                    # NEW v2: append-only memory ops log
└── output/                            # reports, query results, generated artifacts
```

> **Note on `wiki/index.md` version marker:** As of schema v2, `wiki/index.md` MUST include `_schema: 2` in its YAML frontmatter as the canonical version field. `/wiki-ingest` sets this automatically on first v2 run; existing v1 vaults missing the field are treated as v1 and upgraded on next ingest.

## Architecture

Three directories, three roles (see Vault Layout above for full tree):

- **raw/** — immutable source documents. The LLM reads from here but NEVER modifies these files.
- **wiki/** — the LLM's workspace. Create, update, and maintain all files here.
- **output/** — reports, query results, and generated artifacts go here.

Wiki subdirectories:
- `wiki/sources/` — one summary page per ingested source
- `wiki/entities/` — pages for people, organizations, products, tools
- `wiki/concepts/` — pages for ideas, frameworks, theories, patterns
- `wiki/synthesis/` — comparisons, analyses, cross-cutting themes
- `wiki/qa/` — NEW v2: Q&A artifacts saved via `/wiki-query --save` (see §Q&A Articles)

Three special files:
- `wiki/index.md` — master catalog of every wiki page, organized by category. Update on every ingest. Must include `_schema: 2` frontmatter field (v2).
- `wiki/log.md` — append-only chronological record. Never edit existing entries.
- `wiki/cache.md` — rolling ~500-word summary of recent activity. Read FIRST on session startup for fast orientation. Auto-updated by ingest (append) + lint (regen).

## Page Format

Every wiki page MUST include YAML frontmatter:

    ---
    tags: [tag1, tag2]
    aliases: [Title Case Alias]   # entity/concept pages only — see "Aliases" section below
    sources: [source-filename-1.md, source-filename-2.md]
    created: YYYY-MM-DD
    updated: YYYY-MM-DD
    ---

Use `[[wikilink]]` syntax for all internal links. When you mention a concept, entity, or source that has its own page, link it.

> **QA pages** (`wiki/qa/`) use specialized v2 frontmatter — see §Q&A Articles for the full field spec. Standard page frontmatter does NOT apply to QA files.

### `wiki/cache.md` format

The hot cache uses a fixed structure (auto-managed by ingest + lint, do not hand-edit):

    ---
    type: cache
    updated: YYYY-MM-DD
    ---

    # Recent Activity

    ## Last N ingests
    - [YYYY-MM-DD] Source title — 1-line takeaway
    - ...

    ## Active themes
    - Theme 1 — pages [[A]], [[B]]
    - ...

    ## Pending
    - [needs verification] flags from last lint
    - Open questions from query sessions

Cap at ~500 words. Trim oldest entries when exceeded.

## Citation Rules

On entity, concept, and synthesis pages — where information aggregates from multiple sources — cite the specific source for each factual claim using **inline citation**:

- Format: `(source: source-filename.md)` immediately after the claim
- When two sources disagree, note the contradiction explicitly and cite both: `(sources: a.md disagrees with b.md)`
- When a claim has no source, append `[needs verification]` so the next lint pass surfaces it

Source summary pages (`wiki/sources/`) are 1:1 with a single source — inline citation is **not required** there because the entire page derives from that one source. The `sources:` YAML field already captures provenance.

Inline citation gives traceability per-claim that the YAML `sources:` field cannot — the field tells you *which sources* were used, but not *which sentence came from which*.

## Aliases (Obsidian wikilink resolution)

Entity and concept pages MUST have an `aliases:` field whose first entry matches the H1 title (Title Case). Required so Obsidian resolves `[[Title Case]]` wikilinks to the kebab-case file:

    ---
    tags: [author, devops]
    aliases: [Hữu Giang]
    sources: [...]
    ---

    # Hữu Giang

**Why:** Vanilla Obsidian resolves wikilinks by filename basename, NOT H1 title. Without `aliases`, clicking `[[Hữu Giang]]` creates a stray file at vault root because no resolution path exists for kebab → Title.

## Operations

### Ingest (processing a new source)

When the user adds a file to raw/ and asks you to process it:

1. Read the source completely
2. Discuss key takeaways with the user
3. Create a source summary page in `wiki/sources/` with: title, source metadata, key claims, and a structured summary
   - **F1:** When a filename contains commas, quote in YAML: `sources: ["a, b.md"]`
   - **F2:** H1 must match wikilinks strictly. Don't write `# AWS (Amazon Web Services)` if other pages link `[[AWS]]` — use `# AWS` + `aliases: [AWS, Amazon Web Services]`
   - **F4:** `## Entities Mentioned` entries require `- [[Wikilink]] — brief context` format. Never bare `- [[Wikilink]]`
4. Identify all entities and concepts mentioned. For each:
   - **If a wiki page exists (UPDATE):**
     - **F3:** Append the current source filename to the `sources:` YAML array (common bug: forgetting this step)
     - Add new information from this source
     - **K1:** For each new factual claim, append inline `(source: this-source-filename.md)`
     - Note contradictions: `(sources: a.md disagrees with b.md)`
     - Bump `updated:` to today
   - **If no wiki page exists (CREATE):**
     - Choose dir: `wiki/entities/` or `wiki/concepts/`
     - Slugify filename: kebab-case, no special chars
     - **A1:** Add `aliases: [<H1 Title Case>]` to YAML frontmatter
     - Add `tags:`, `sources:` (single entry), `created:`, `updated:`
     - Body H1 matches `aliases[0]` exactly (F2)
     - **K1:** Each factual claim has inline `(source: filename.md)` citation
     - **K2:** Any claim you can't source: append `[needs verification]`
5. Add `[[wikilinks]]` between all related pages. Use Title Case matching the page H1.
6. Update `wiki/index.md` with any new pages
7. Append to `wiki/log.md`: `## [YYYY-MM-DD] ingest | Source Title`
8. **N1 hot cache:** Append 1-line entry to `wiki/cache.md` under "## Last N ingests": `- [YYYY-MM-DD] {{title}} — {{takeaway}}`. Trim oldest if cache exceeds ~500 words.

A single source may touch 10-15 wiki pages. That is normal.

**K1 exception:** Source summary pages (`wiki/sources/`) do NOT need inline citations — the entire page is 1:1 with one source already declared in `sources:` frontmatter.

### Query (answering questions)

When the user asks a question:

1. Read `wiki/index.md` to find relevant pages
2. Read the relevant wiki pages
3. Synthesize an answer with `[[wikilink]]` citations to wiki pages
4. If the answer produces a valuable artifact (comparison, analysis, new connection), offer to save it as a new page in `wiki/synthesis/`
5. If you save a new page, update the index and log

### Lint (health check)

When the user asks you to lint or health-check the wiki:

1. Scan for contradictions between pages
2. Find stale claims that newer sources have superseded
3. Identify orphan pages (no inbound links)
4. Find important concepts mentioned but lacking their own page
5. Check for missing cross-references
6. Suggest data gaps that could be filled with a web search
7. Report findings and offer to fix issues
8. Log the lint pass: `## [YYYY-MM-DD] lint | Summary of findings`

## Index Format

Each entry in `wiki/index.md` is one line:

    - [[Page Name]] — one-line summary

Organized under category headers: Sources, Entities, Concepts, Synthesis.

## Log Format

Each entry in `wiki/log.md`:

    ## [YYYY-MM-DD] operation | Title
    Brief description of what was done.

## Page Naming

Filenames use **kebab-case** with `.md` extension. Page titles inside the file use **Title Case**.

- Source pages: `wiki/sources/article-title-here.md` → `# Article Title Here`
- Entity pages: `wiki/entities/entity-name.md` → `# Entity Name`
- Concept pages: `wiki/concepts/concept-name.md` → `# Concept Name`
- Synthesis pages: `wiki/synthesis/comparison-topic.md` → `# Comparison Topic`

When creating `[[wikilinks]]`, use the page title (Title Case), not the filename:
- Correct: `[[Entity Name]]`
- Wrong: `[[entity-name]]`

To slugify a title into a filename: lowercase, replace spaces with hyphens, remove special characters, trim to reasonable length.

## Image Handling

Web-clipped articles often include images. Handle them as follows:

1. **Download images locally.** In Obsidian Settings → Files and links, set "Attachment folder path" to `raw/assets/`. Then use "Download attachments for current file" (bind it to a hotkey like Ctrl+Shift+D) after clipping an article.
2. **Reference images from wiki pages** using standard markdown: `![description](../raw/assets/image-name.png)`. Keep the image in `raw/assets/` — never copy images into `wiki/`.
3. **During ingestion**, note any images in the source. If an image contains important information (diagrams, charts, data), describe its contents in the wiki page so the knowledge is captured in text form.

## Lint Frequency

Run a lint pass (`/wiki-lint`) on this schedule:
- **After every 10 ingests** — catches cross-reference gaps while they're fresh
- **Monthly at minimum** — catches stale claims and orphan pages that accumulate over time
- **Before any major query or synthesis** — ensures the wiki is healthy before you rely on it for analysis

## Q&A Articles (wiki/qa/)

### Purpose

Q&A articles persist valuable question-answer pairs as first-class wiki artifacts. They are created by `/wiki-query --save`, validated by `/wiki-lint` step 14, and can be promoted to full concept pages via `/wiki-ingest --promote-qa <slug>`.

### Naming

- Filenames use **kebab-case slug**, max 60 characters, `.md` extension
- Example: `wiki/qa/how-does-incremental-ingest-work.md`
- SHA1 prefix fallback for slug collisions: `wiki/qa/<sha1-7>-<truncated-slug>.md`

### v2 Frontmatter Spec

QA articles use specialized frontmatter. All 9 fields are required:

| Field            | Type             | Required | Description                                                    |
|------------------|------------------|----------|----------------------------------------------------------------|
| `tags`           | list[str]        | yes      | Always includes `qa`; add topic tags                          |
| `aliases`        | list[str]        | yes      | First entry = verbatim original question                      |
| `question`       | str              | yes      | Verbatim original question (quote if special chars present)   |
| `asked_at`       | ISO datetime     | yes      | When the question was asked (e.g. `2026-05-05T10:21:00Z`)    |
| `confidence`     | enum             | yes      | `high` / `medium` / `low`                                     |
| `answer_summary` | str              | yes      | One-sentence TL;DR of the answer                              |
| `sources`        | list[path]       | yes      | Cited wiki articles (wikilinks resolved to relative paths)    |
| `created`        | date             | yes      | Creation date (YYYY-MM-DD)                                    |
| `updated`        | date             | yes      | Last edit date (YYYY-MM-DD)                                   |

Example:

    ---
    tags: [qa, ingest, incremental]
    aliases: ["How does incremental ingest work?"]
    question: "How does incremental ingest work?"
    asked_at: 2026-05-05T10:21:00Z
    confidence: high
    answer_summary: "/wiki-ingest checks .state.json SHA-256 hashes to skip unchanged files."
    sources: [wiki/concepts/incremental-ingest.md]
    created: 2026-05-05
    updated: 2026-05-05
    ---

### Body Template

    # <Question as Title>

    ## Answer
    Full answer text with `[[wikilinks]]` to cited pages.

    ## Reasoning
    How the answer was derived; note any uncertainty or assumptions.

    ## Related
    - [[Related Concept One]]
    - [[Related Concept Two]]

### Lifecycle

1. **Created** — by `/wiki-query --save` at end of a query session
2. **Validated** — by `/wiki-lint` step 14 (checks all 9 required fields, slug length)
3. **Promoted** — optional: `/wiki-ingest --promote-qa <slug>` converts to `wiki/concepts/` page, removes QA from `wiki/qa/`
4. **Index** — every QA article is listed under a `Q&A` category header in `wiki/index.md`

---

## State Tracking (wiki/.state.json)

### Purpose

`.state.json` enables incremental ingest: `/wiki-ingest` skips files whose SHA-256 hash matches the stored value, avoiding redundant re-processing of unchanged sources.

### Format

```json
{
  "version": 1,
  "files": {
    "<relative-path-from-vault-root>": {
      "sha256": "<64-char-hex>",
      "ingested_at": "<ISO-datetime>",
      "ingested_into": ["<wiki-relative-path>", "..."]
    }
  }
}
```

Field notes:
- `version` — always `1` (schema version of the state file itself)
- `files` — map of vault-relative paths to ingest records
- `sha256` — SHA-256 hex digest of the source file at ingest time
- `ingested_at` — ISO-8601 datetime when ingest ran
- `ingested_into` — list of wiki pages created/updated by this ingest

### Lifecycle

- **Created/updated** — by `/wiki-ingest` after each successful file ingest
- **Validated** — by `/wiki-lint` step 15 (checks JSON validity, version=1, no stale paths)
- **Manual reset** — `rm wiki/.state.json` forces full re-ingest on next run

### Security Note (S-5)

`.state.json` records vault-relative file paths. If the vault is in a public git repository, these paths may leak directory structure. **Recommendation:** add `wiki/.state.json` to `.gitignore` for public vaults.

---

## Memory Log (wiki/.memory.log)

### Append-Only Contract

`.memory.log` is a plain-text append-only log. **Never edit or delete historical entries.** Only append new lines. Tools that read this file must handle partial/truncated content gracefully.

### Format

Each line:

    <ISO-timestamp> <operation> <session_id_or_filename> <details>

- `ISO-timestamp` — UTC, format `2026-05-05T10:21:00Z`
- `operation` — one of the operations listed below
- `session_id_or_filename` — short identifier (session ID hash or target filename)
- `details` — free-form context (e.g. `-> raw/sessions/2026-05-05-1021-abc12345.md`)

### Operations

| Operation      | Triggered by                              | Description                                  |
|----------------|-------------------------------------------|----------------------------------------------|
| `session-end`  | SessionEnd hook                           | Session transcript saved to `raw/sessions/`  |
| `pre-compact`  | PreCompact hook                           | Pre-compact snapshot saved to `raw/sessions/`|
| `flush-manual` | `/wiki-memory flush`                      | Manual flush triggered by user               |
| `enable`       | `/wiki-memory enable`                     | wiki-memory add-on activated                 |
| `disable`      | `/wiki-memory disable`                    | wiki-memory add-on deactivated               |
| `qa-save`      | `/wiki-query --save`                      | Q&A article saved to `wiki/qa/`              |
| `promote-qa`   | `/wiki-ingest --promote-qa <slug>`        | QA article promoted to concept page          |

### Example Entries

    2026-05-05T10:21:00Z session-end abc12345 -> raw/sessions/2026-05-05-1021-abc12345.md
    2026-05-05T10:25:00Z pre-compact abc12345 -> raw/sessions/pre-compact-2026-05-05-1025-abc12345.md
    2026-05-05T11:00:00Z qa-save how-does-x-work -> wiki/qa/how-does-x-work.md
    2026-05-05T11:30:00Z enable scope=global
    2026-05-05T12:00:00Z promote-qa how-does-x-work -> wiki/concepts/how-does-x-work.md

---

## Optional Add-on: wiki-memory

`wiki-memory` is an opt-in add-on that automatically captures Claude Code session transcripts into `raw/sessions/` and feeds them into the wiki ingest pipeline. When enabled, three hooks fire automatically: **SessionEnd** (saves full transcript), **PreCompact** (saves pre-compaction snapshot), and **SessionStart** (loads `wiki/cache.md` for fast orientation). The add-on is **OFF by default** — activate via `/wiki` setup wizard (Q11) or `/wiki-memory enable`. Disabling with `/wiki-memory disable` leaves existing session files intact.

For full spec, session filename conventions, hook payloads, and configuration options, see `skills/wiki-memory/SKILL.md`.

---

## Migration: v1 → v2

Existing v1 vaults are **fully backwards compatible**. No data migration is required.

- **Missing directories** (`raw/sessions/`, `wiki/qa/`) are auto-created on the next `/wiki` re-run or on first `/wiki-memory enable`
- **`.state.json`** and **`.memory.log`** are created on first use; absent files are treated as empty state
- **`_schema: 2`** field in `wiki/index.md` is set automatically by `/wiki-ingest` on first v2 run; missing field = treat as v1 vault (upgrade path)
- No existing pages, links, or frontmatter are modified during migration

---

## Tools

You have access to these CLI tools — use them when appropriate:

- **summarize** — summarize links, files, and media. Run `summarize --help` for usage.
- **qmd** — local search engine for markdown files. Run `qmd --help` for usage. Use when the wiki grows beyond what index.md can efficiently navigate.
- **agent-browser** — browser automation for web research. Use when web_search or web_fetch fail.

## Rules

1. Never modify files in `raw/`. They are immutable source material.
2. Always update `wiki/index.md` when you create or delete a page.
3. Always append to `wiki/log.md` when you perform an operation.
4. Use `[[wikilinks]]` for all internal references. Never use raw file paths in page content.
5. Every wiki page must have YAML frontmatter with tags, sources, created, and updated fields.
6. When new information contradicts existing wiki content, update the wiki page and note the contradiction with both sources cited.
7. Keep source summary pages factual. Save interpretation and synthesis for concept and synthesis pages.
8. When asked a question, search the wiki first. Only go to raw sources if the wiki doesn't have the answer.
9. Prefer updating existing pages over creating new ones. Only create a new page when the topic is distinct enough to warrant it.
10. Keep `wiki/index.md` concise — one line per page, under 120 characters per entry.
11. On entity/concept/synthesis pages, cite each factual claim inline `(source: filename.md)`. Source pages don't need inline citations (they're 1:1 with one source).
12. When a claim has no source, append `[needs verification]` so the next lint pass surfaces it for follow-up research.
13. Lint passes MUST flag `[needs verification]` markers and orphan claims with no inline citation on aggregator pages.
14. Entity and concept pages MUST have `aliases: [<H1 Title Case>]` in YAML frontmatter — required for Obsidian wikilink resolution between kebab-case filenames and Title Case wikilinks.
15. Q&A articles in `wiki/qa/` MUST use v2 specialized frontmatter with all 9 required fields (`tags`, `aliases`, `question`, `asked_at`, `confidence`, `answer_summary`, `sources`, `created`, `updated`). Standard page frontmatter is not sufficient.
16. `wiki/.state.json` MUST be valid JSON with `version` set to `1`. Malformed or missing-version state files must be rejected and regenerated.
17. `wiki/.memory.log` is append-only. Historical entries MUST NOT be edited or deleted. Tools reading this file must tolerate partial content.
18. `wiki/index.md` MUST have `_schema: 2` in its YAML frontmatter as the canonical schema version marker for the vault. `/wiki-ingest` sets this on first v2 run; lint step validates its presence.
