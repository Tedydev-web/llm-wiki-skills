---
name: wiki-ingest
description: >
  Process raw source documents into LLM Wiki pages. Use when the user adds
  files to raw/ and wants them ingested, says "process this source",
  "ingest this article", "I added something to raw/", or wants to
  incorporate new material into their knowledge base / second brain.
allowed-tools: Bash Read Write Edit Glob Grep
---

# LLM Wiki — Ingest

Process raw source documents into structured, interlinked wiki pages.

## Identify Sources to Process

Determine which files need ingestion:

1. If the user specifies a file or files, use those
2. If the user says "process new sources" or similar, detect unprocessed files:
   - List all files in `raw/` (excluding `raw/assets/`)
   - Read `wiki/log.md` and extract all previously ingested source filenames from `ingest` entries
   - Any file in `raw/` not listed in the log is unprocessed
3. If no unprocessed files are found, tell the user

## Process Each Source

For each source file, follow this workflow:

### 1. Read the source completely

Read the entire file. If the file contains image references, note them — read the images separately if they contain important information.

### 2. Discuss key takeaways with the user

Before writing anything, share the 3-5 most important takeaways from the source. Ask the user if they want to emphasize any particular aspects or skip any topics. Wait for confirmation before proceeding.

### 3. Create source summary page

Create a new file in `wiki/sources/` named after the source (slugified). Include:

    ---
    tags: [relevant, tags]
    sources: ["bai-15-best-practices, security.md"]   # F1: quote in YAML when filename contains commas
    created: YYYY-MM-DD
    updated: YYYY-MM-DD
    ---

    # Source Title

    **Source:** original-filename.md
    **Date ingested:** YYYY-MM-DD
    **Type:** article | paper | transcript | notes | etc.

    ## Summary

    Structured summary of the source content.

    ## Key Claims

    - Claim 1
    - Claim 2
    - ...

    ## Entities Mentioned

    - [[Entity Name]] — brief context from this source
    - [[Other Entity]] — brief context (NEVER bare `- [[Entity Name]]` — F4)

    ## Concepts Covered

    - [[Concept Name]] — brief context from this source
    - ...

> **F2 (H1 strict for wikilinks):** H1 must match wikilinks exactly. Don't write `# AWS (Amazon Web Services)` if other pages link `[[AWS]]`. Use `# AWS` + `aliases: [AWS, Amazon Web Services]` instead.

> **K1 exception:** Source summary pages do NOT need inline `(source: ...)` citations — the entire page is 1:1 with one source already declared in `sources:` frontmatter.

### 4. Update entity and concept pages

For each entity (person, organization, product, tool) and concept (idea, framework, theory, pattern) mentioned in the source, follow 4a OR 4b based on whether the page already exists.

#### 4a. If page already exists (UPDATE)

1. Read the existing page
2. **F3:** Append the current source filename to the `sources:` YAML array. Verify the array contains the new entry. (Common bug: forgetting this step → lint will flag it.)
3. Add new information from this source
4. **K1:** For each new factual claim, append `(source: this-source-filename.md)` inline immediately after the claim
5. Note contradictions explicitly: `(sources: a.md disagrees with b.md)` — cite both sources
6. Bump `updated:` field to today
7. **K2:** If you write any claim you can't source, append `[needs verification]` so the next lint pass surfaces it

#### 4b. If page does not exist (CREATE)

1. Choose dir: `wiki/entities/` (people, orgs, products, tools) or `wiki/concepts/` (ideas, frameworks, theories, patterns)
2. Slugify filename: kebab-case, no special chars
3. **A1:** Add `aliases: [<H1 Title Case>]` to YAML frontmatter — required so Obsidian resolves `[[Title Case]]` wikilinks → kebab-case file. First entry must match H1 exactly.
4. Add `tags:`, `sources:` (single entry), `created:`, `updated:` fields
5. Body H1 matches `aliases[0]` exactly (F2)
6. **K1:** Each factual claim has inline `(source: filename.md)` citation
7. **K2:** Any claim you can't source: append `[needs verification]`
8. Write a focused summary based on what this source says about the topic

#### 4c. Verification examples

**CORRECT — entity page baked with A1 + F2 + K1 + K2:**

    ---
    tags: [cloud, aws]
    aliases: [AWS]
    sources: [bai-13-aws-deploy.md]
    created: 2026-05-04
    updated: 2026-05-04
    ---

    # AWS

    Amazon Web Services là cloud provider hàng đầu (source: bai-13-aws-deploy.md).
    Tốc độ tăng trưởng 2024 đạt 19% [needs verification].

**WRONG — regression risks the LLM must avoid:**

    ---
    tags: [cloud]
    sources: [bai-13-aws-deploy.md]   # missing aliases (A1 fail)
    ---

    # AWS (Amazon Web Services)   # F2 fail: doesn't match [[AWS]] wikilink

    Cloud provider.   # K1 fail: no inline citation

#### 4d. Update wiki/cache.md (N1, hot cache)

After 4a/4b finish for all entities/concepts in this source, append a 1-line entry to `wiki/cache.md` under `## Last N ingests`:

    - [YYYY-MM-DD] {{source title}} — {{1-line takeaway from step 2 discussion}}

Rules:
- If `wiki/cache.md` doesn't exist yet, create it with the schema from `references/wiki-schema.md` → "wiki/cache.md format"
- If cache exceeds ~500 words: trim oldest entries (keep last 10-15 ingests)
- Don't re-summarize the whole cache here — append only. Active themes get refreshed by `/wiki-lint` audit step 13.

**Why:** Hot cache lets future sessions read recent activity in seconds without scanning the whole index. Ingest must keep it current — lint regenerates it.

### 5. Add wikilinks

Ensure all related pages link to each other using `[[wikilink]]` syntax. Every mention of an entity or concept that has its own page should be linked.

**F2 reinforcement:** Use `[[Title Case]]` matching the page's H1 exactly. If H1 has parens or subtitle, alias must include both forms — but **prefer simple H1, complex aliases**. Never write `[[AWS (Amazon Web Services)]]` when the H1 is `# AWS`.

### 6. Update wiki/index.md

For each new page created, add an entry under the appropriate category header:

    - [[Page Name]] — one-line summary (under 120 characters)

### 7. Update wiki/log.md

Append:

    ## [YYYY-MM-DD] ingest | Source Title
    Processed source-filename.md. Created N new pages, updated M existing pages.
    New entities: [[Entity1]], [[Entity2]]. New concepts: [[Concept1]].

### 8. Report results

Tell the user what was done:
- Pages created (with links)
- Pages updated (with what changed)
- New entities and concepts identified
- Any contradictions found with existing content

## Conventions

- Source summary pages are **factual only**. Save interpretation and synthesis for concept and synthesis pages.
- A single source typically touches **10-15 wiki pages**. This is normal and expected.
- When new information contradicts existing wiki content, **update the wiki page and note the contradiction** with both sources cited.
- **Prefer updating existing pages** over creating new ones. Only create a new page when the topic is distinct enough to warrant its own page.
- Use `[[wikilinks]]` for all internal references. Never use raw file paths.
- **A1 (aliases):** Every entity/concept page MUST have `aliases: [<H1 Title Case>]` — Obsidian wikilink resolution depends on it. Source pages don't need aliases (they're 1:1 with one source).
- **K1 (inline citation):** On entity/concept/synthesis pages, every factual claim gets `(source: filename.md)` immediately after. Source pages exempt — `sources:` frontmatter already declares the single origin.
- **K2 (needs verification):** When you write a claim you can't source, append `[needs verification]`. Better than silent omission — the next lint pass surfaces it for follow-up research.
- **F3 (sources array):** When updating an existing entity/concept page, append the current source filename to the `sources:` YAML array. Forgetting this breaks lint's source completeness check.

## What's Next

After ingesting sources, the user can:
- **Ask questions** with `/wiki-query` to explore what was ingested
- **Ingest more sources** — clip another article and run `/wiki-ingest` again
- **Health-check** with `/wiki-lint` after every 10 ingests to catch gaps
