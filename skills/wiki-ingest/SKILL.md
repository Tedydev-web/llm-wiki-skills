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

**Vault path:** read from `$WIKI_MEMORY_VAULT` env, else `cat ~/.config/wiki/sidecar.json | jq -r .vault_path`, else `cat ~/.config/wiki-memory/vault-path` (legacy), else ask user.

## Commands

- `/wiki-ingest` — process files in `raw/` (and `raw/sessions/` if wiki-memory enabled)
- `/wiki-ingest --promote-qa <slug>` — graduate `wiki/qa/<slug>.md` into a permanent concept page

## Identify Sources to Process

1. If the user specifies a file or files, use those
2. If the user says "process new sources" or similar, detect unprocessed files:
   - List all files in `raw/` (excluding `raw/assets/`)
   - Read `wiki/log.md` and extract all previously ingested source filenames from `ingest` entries
   - Any file in `raw/` not listed in the log is unprocessed
3. If no unprocessed files are found, tell the user

## Workflow (High Level)

For each source file:

1. **Step 0 — State check:** read `wiki/.state.json`, compute SHA256, skip unchanged files.
   For full spec: `Read skills/wiki-ingest/references/state-json-spec.md`
2. **Steps 1–8 — Ingest pipeline:** read source → discuss takeaways → create source page → update entity/concept pages → add wikilinks → update index → update log → report.
   For full walkthrough: `Read skills/wiki-ingest/references/ingest-walkthrough.md`
3. **Step N — State write:** update `.state.json` atomically with computed hashes + output paths.
   For full spec: `Read skills/wiki-ingest/references/state-json-spec.md`

For `--promote-qa` mode (skips pipeline entirely):
`Read skills/wiki-ingest/references/promote-qa-workflow.md`

## Quick Example

User: "I added `raw/article-on-aws.md`, please ingest it."

1. Read `.state.json` — check SHA256 of `raw/article-on-aws.md`; if unchanged since last run, skip
2. Read the article; share 3-5 key takeaways; wait for user confirmation
3. Create `wiki/sources/article-on-aws.md`
4. Create or update `wiki/entities/aws.md`, `wiki/concepts/cloud-cost-optimization.md`, etc.
5. Update `wiki/index.md` + `wiki/cache.md` + append to `wiki/log.md`
6. Write updated `.state.json`

## Conventions

- Source summary pages are **factual only**. Save interpretation for concept and synthesis pages.
- A single source typically touches **10–15 wiki pages**. This is normal.
- When new information contradicts existing content, **update the page and note the contradiction** with both sources cited.
- **Prefer updating existing pages** over creating new ones.
- Use `[[wikilinks]]` for all internal references — never raw file paths.
- **A1 (aliases):** Every entity/concept page MUST have `aliases: [<H1 Title Case>]`.
- **K1 (inline citation):** On entity/concept/synthesis pages, every factual claim gets `(source: filename.md)` inline. Source pages exempt.
- **K2 (needs verification):** Unsourceable claims get `[needs verification]` — surfaced by next lint pass.
- **F3 (sources array):** When updating an existing page, append the current source filename to `sources:` YAML array.

## References

- `skills/wiki-ingest/references/state-json-spec.md` — Step 0 + Step N full spec (SHA256, dedup, atomic write, mkdir-lock)
- `skills/wiki-ingest/references/ingest-walkthrough.md` — Steps 1–8 pipeline (source page, entity/concept update, wikilinks, index, log)
- `skills/wiki-ingest/references/promote-qa-workflow.md` — `--promote-qa` mode (preconditions → mutation → postconditions)

## What's Next

After ingesting sources, the user can:
- **Ask questions** with `/wiki-query`
- **Ingest more sources** — clip another article and run `/wiki-ingest` again
- **Health-check** with `/wiki-lint` after every 10 ingests
