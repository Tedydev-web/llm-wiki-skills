# Wiki Schema

Canonical rules for LLM-maintained knowledge base wikis. This is the single source of truth — agent config templates pull from this document.

## Architecture

Three directories, three roles:

- **raw/** — immutable source documents. The LLM reads from here but NEVER modifies these files.
- **wiki/** — the LLM's workspace. Create, update, and maintain all files here.
- **output/** — reports, query results, and generated artifacts go here.

Wiki subdirectories:
- `wiki/sources/` — one summary page per ingested source
- `wiki/entities/` — pages for people, organizations, products, tools
- `wiki/concepts/` — pages for ideas, frameworks, theories, patterns
- `wiki/synthesis/` — comparisons, analyses, cross-cutting themes

Three special files:
- `wiki/index.md` — master catalog of every wiki page, organized by category. Update on every ingest.
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
