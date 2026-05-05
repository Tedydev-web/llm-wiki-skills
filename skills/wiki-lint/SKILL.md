---
name: wiki-lint
description: >
  Health-check the LLM Wiki / knowledge base for contradictions, orphan
  pages, stale claims, missing cross-references, missing aliases, and
  un-cited claims. Use when the user says "audit", "health check", "lint",
  "find problems", or wants to improve wiki quality.
allowed-tools: Bash Read Write Edit Glob Grep
---

# LLM Wiki — Lint

Health-check the wiki and report issues with actionable fixes.

## Audit Steps

Run all checks below, then present a consolidated report.

### 1. Broken wikilinks

Scan all wiki pages for `[[wikilink]]` references. For each link, verify the target page exists. Report any broken links.

```bash
# Find all wikilinks across wiki pages
grep -roh '\[\[[^]]*\]\]' wiki/ | sort -u
```

Cross-reference against actual files in `wiki/`.

### 2. Orphan pages

Find pages with no inbound links — no other page references them via `[[wikilink]]`.

For each `.md` file in `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, `wiki/synthesis/`:
- Extract the page name (filename without extension)
- Search all other wiki pages for `[[Page Name]]`
- If no other page links to it, it's an orphan

### 3. Contradictions

Read pages that share entities or concepts and look for conflicting claims. Flag when:
- Two source summaries make opposing claims about the same topic
- An entity page contains information that conflicts with a source summary
- Dates, figures, or factual claims differ between pages

### 4. Stale claims

Cross-reference source dates with wiki content. Flag when:
- A concept page cites only old sources and newer sources exist on the same topic
- Entity information hasn't been updated despite newer sources mentioning that entity

### 5. Missing pages

Scan for `[[wikilinks]]` that point to pages that don't exist yet. These are topics the wiki mentions but hasn't given their own page. Assess whether they warrant a page.

### 6. Missing cross-references

Find pages that discuss the same topics but don't link to each other. Look for:
- Entity pages that mention concepts without linking them
- Concept pages that mention entities without linking them
- Source summaries that cover the same topic but don't reference each other

### 7. Index consistency

Verify `wiki/index.md` is complete and accurate:
- Every page in `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, `wiki/synthesis/` has an index entry
- No index entries point to deleted pages
- Entries are under the correct category header

### 8. Data gaps

Based on the wiki's current coverage, suggest:
- Topics mentioned frequently but lacking depth
- Questions the wiki can't answer well
- Areas where a web search could fill in missing information

### 9. Aliases consistency (L1a)

For each `.md` file in `wiki/entities/` and `wiki/concepts/`:

1. Parse YAML frontmatter — confirm `aliases:` field present
2. Confirm `aliases[0]` matches the H1 of the page (Title Case, exact match)
3. Flag missing or mismatched aliases as **errors**

**Why:** Without `aliases:`, Obsidian creates stray files at vault root when the user clicks `[[Title Case]]` wikilink — Obsidian resolves wikilinks by filename basename, NOT by H1. The `aliases:` field is the bridge.

**Synthesis pages exempt:** This check applies to `wiki/entities/` + `wiki/concepts/` only. Synthesis pages don't need aliases by design.

### 10. Verification tags (L1b)

Grep all wiki pages for the literal string `[needs verification]`. Report each occurrence with file path, line number, and the surrounding claim text.

```bash
grep -rn '\[needs verification\]' wiki/
```

Classify as **warning** — these are intentional follow-up flags from K2 ingest behavior. Lint surfaces them so they don't accumulate silently.

### 11. Missing inline citations (L1c)

For each `.md` file in `wiki/entities/`, `wiki/concepts/`, `wiki/synthesis/`:

1. Skip code blocks, headers, and list items that are pure wikilinks (e.g. `- [[Entity]]`)
2. For each remaining sentence (period-terminated body text), check whether it ends with `(source: ...)`, `(sources: ...)`, or `[needs verification]`
3. If neither: report as **suspect claim**

**Why:** K1 requires per-claim provenance on aggregator pages — `sources:` frontmatter only records *which* sources, not *which sentence came from which*.

**Heuristic — false positives possible.** Classify as **info**, not error. User reviews.

**Noise cap:** Cap report at **top-10 pages** with most suspect claims. Format:

    page-name.md: 12 suspect claims (top-3 examples)
      L42: "Cloud provider grew 19% in 2024."
      L57: "Lambda's cold-start hovers around 100ms."
      L89: "Reserved instances save up to 75%."

Drop pages with <3 suspect claims (likely false positives). On a fresh wiki this should be 0; on legacy wikis the top-10 actionable list beats a noisy comprehensive dump.

### 12. Sources-array completeness (F3)

For each entity/concept page:

1. Grep all `wiki/sources/*.md` for any wikilink pointing to this entity/concept (e.g. `[[Entity Name]]`)
2. Cross-reference with the entity/concept page's `sources:` YAML array
3. If a source summary mentions the entity but the entity page's `sources:` array doesn't include that source filename → report as **error: missing source ref**

**Why:** F3 incident — early ingest forgot to append-to-sources-array; an entity page ended up with 2 of 14 actual sources listed. Lint catches drift.

**Scale note:** O(N×M). Instant at <500 pages. For mega-wikis (>500 pages): use `qmd` indexed search OR skip step 12.

### 13. Regenerate `wiki/cache.md` (N1, hot cache)

After all other audits complete, regenerate the hot cache from authoritative sources so it doesn't drift over time:

1. Read last 10-15 entries from `wiki/log.md` (most recent ingests)
2. For each: extract date + title + 1-line summary
3. Identify "Active themes" — top 3-5 entity/concept pages with most recent `updated:` frontmatter dates
4. List "Pending" — count of `[needs verification]` flags from step 10 + count of L1c suspect citations from step 11
5. **Overwrite** `wiki/cache.md` (don't append — regenerate fresh). Cap at ~500 words.

Format follows `references/wiki-schema.md` → `wiki/cache.md` format spec.

**Why:** Hot cache (N1) gives fast session startup. Ingest appends entries; lint regenerates from scratch so cache reflects current truth.

## Report Format

Present findings grouped by severity:

### Errors (must fix)
- Broken wikilinks
- Contradictions between pages
- Index entries pointing to missing pages
- Aliases missing or mismatched (L1a, step 9)
- Sources-array missing source refs (F3, step 12)

### Warnings (should fix)
- Orphan pages with no inbound links
- Stale claims from outdated sources
- Missing pages for frequently referenced topics
- `[needs verification]` flags pending research (L1b, step 10)

### Info (nice to fix)
- Potential cross-references to add
- Data gaps that could be filled
- Index entries that could be more descriptive
- Suspected missing inline citations (L1c, step 11) — top-10 pages only

For each finding, include:
- **What:** description of the issue
- **Where:** the specific file(s) and line(s)
- **Fix:** what to do about it

## After the Report

Ask the user:
> "Found N errors, N warnings, and N info items. Want me to fix any of these?"

If the user agrees, fix issues and report what changed.

## Log the lint pass

Append to `wiki/log.md`:

    ## [YYYY-MM-DD] lint | Health check
    Found N errors (B broken, A aliases, S sources-incomplete), M warnings (V verification flags, ...), K info items.
    Regenerated wiki/cache.md.
    Fixed: [list of fixes applied].

## Quick-lint shell commands

Reference one-liners for the most mechanical checks. The LLM can run these directly instead of re-deriving regexes.

```bash
# Step 9 (L1a): aliases missing
for f in wiki/entities/*.md wiki/concepts/*.md; do
  grep -q '^aliases:' "$f" || echo "MISSING aliases: $f"
done

# Step 10 (L1b): verification flags
grep -rn '\[needs verification\]' wiki/

# Step 1: all wikilinks (cross-reference against actual files)
grep -roh '\[\[[^]]*\]\]' wiki/ | sort -u

# Step 12 (F3): sources-array completeness — prose-only, too complex for one-liner
# Use Read + Grep tools per page in entities/ + concepts/
```

## When to Lint

- **After every 10 ingests** — catches cross-reference gaps while they're fresh
- **Monthly at minimum** — catches stale claims and orphan pages over time
- **Before major queries** — ensures the wiki is healthy before you rely on it for analysis

## Related Skills

- `/wiki-ingest` — process new sources into wiki pages
- `/wiki-query` — ask questions against the wiki
