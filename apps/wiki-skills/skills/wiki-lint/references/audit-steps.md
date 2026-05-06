---
title: "wiki-lint — Audit Steps"
loaded_by: wiki-lint
---

# Audit Steps

Full prose specification for all 17 wiki-lint audit steps. Each step is self-contained.

## Step 1: Broken Wikilinks

Scan all wiki pages for `[[wikilink]]` references. For each link, verify the target page exists. Report any broken links.

```bash
# Find all wikilinks across wiki pages
grep -roh '\[\[[^]]*\]\]' wiki/ | sort -u
```

Cross-reference against actual files in `wiki/`.

## Step 2: Orphan Pages

Find pages with no inbound links — no other page references them via `[[wikilink]]`.

For each `.md` file in `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, `wiki/synthesis/`:
- Extract the page name (filename without extension)
- Search all other wiki pages for `[[Page Name]]`
- If no other page links to it, it's an orphan

## Step 3: Contradictions

Read pages that share entities or concepts and look for conflicting claims. Flag when:
- Two source summaries make opposing claims about the same topic
- An entity page contains information that conflicts with a source summary
- Dates, figures, or factual claims differ between pages

## Step 4: Stale Claims

Cross-reference source dates with wiki content. Flag when:
- A concept page cites only old sources and newer sources exist on the same topic
- Entity information hasn't been updated despite newer sources mentioning that entity

## Step 5: Missing Pages

Scan for `[[wikilinks]]` that point to pages that don't exist yet. These are topics the wiki mentions but hasn't given their own page. Assess whether they warrant a page.

## Step 6: Missing Cross-References

Find pages that discuss the same topics but don't link to each other. Look for:
- Entity pages that mention concepts without linking them
- Concept pages that mention entities without linking them
- Source summaries that cover the same topic but don't reference each other

## Step 7: Index Consistency

Verify `wiki/index.md` is complete and accurate:
- Every page in `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, `wiki/synthesis/` has an index entry
- No index entries point to deleted pages
- Entries are under the correct category header

## Step 8: Data Gaps

Based on the wiki's current coverage, suggest:
- Topics mentioned frequently but lacking depth
- Questions the wiki can't answer well
- Areas where a web search could fill in missing information

## Step 9: Aliases Consistency (L1a)

For each `.md` file in `wiki/entities/` and `wiki/concepts/`:

1. Parse YAML frontmatter — confirm `aliases:` field present
2. Confirm `aliases[0]` matches the H1 of the page (Title Case, exact match)
3. Flag missing or mismatched aliases as **errors**

**Why:** Without `aliases:`, Obsidian creates stray files at vault root when the user clicks `[[Title Case]]` wikilink — Obsidian resolves wikilinks by filename basename, NOT by H1. The `aliases:` field is the bridge.

**Synthesis pages exempt:** This check applies to `wiki/entities/` + `wiki/concepts/` only. Synthesis pages don't need aliases by design.

## Step 10: Verification Tags (L1b)

Grep all wiki pages for the literal string `[needs verification]`. Report each occurrence with file path, line number, and the surrounding claim text.

```bash
grep -rn '\[needs verification\]' wiki/
```

Classify as **warning** — these are intentional follow-up flags from K2 ingest behavior. Lint surfaces them so they don't accumulate silently.

## Step 11: Missing Inline Citations (L1c)

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

## Step 12: Sources-Array Completeness (F3)

For each entity/concept page:

1. Grep all `wiki/sources/*.md` for any wikilink pointing to this entity/concept (e.g. `[[Entity Name]]`)
2. Cross-reference with the entity/concept page's `sources:` YAML array
3. If a source summary mentions the entity but the entity page's `sources:` array doesn't include that source filename → report as **error: missing source ref**

**Why:** F3 incident — early ingest forgot to append-to-sources-array; an entity page ended up with 2 of 14 actual sources listed. Lint catches drift.

**Scale note:** O(N×M). Instant at <500 pages. For mega-wikis (>500 pages): use `qmd` indexed search OR skip step 12.

## Step 13: Regenerate `wiki/cache.md` (N1, Hot Cache)

After all other audits complete, regenerate the hot cache from authoritative sources so it doesn't drift over time:

1. Read last 10-15 entries from `wiki/log.md` (most recent ingests)
2. For each: extract date + title + 1-line summary
3. Identify "Active themes" — top 3-5 entity/concept pages with most recent `updated:` frontmatter dates
4. List "Pending" — count of `[needs verification]` flags from step 10 + count of L1c suspect citations from step 11
5. **Overwrite** `wiki/cache.md` (don't append — regenerate fresh). Cap at ~500 words.

Format follows `references/wiki-schema.md` → `wiki/cache.md` format spec.

**Why:** Hot cache (N1) gives fast session startup. Ingest appends entries; lint regenerates from scratch so cache reflects current truth.

## Step 14: Q&A Artifact Integrity

Validate all `wiki/qa/*.md` files for structural correctness and reachability. Two sub-checks run in sequence.

**14a — Orphan detection:**

For each `.md` file in `wiki/qa/`:
1. Read `wiki/index.md` Q&A section for an entry referencing this file
2. Also grep all other wiki pages for `[[<slug-or-title>]]` wikilinks pointing to this QA article
3. If neither the index nor any other wiki page links to this file → flag as **orphan**

```bash
# Quick pass: check whether any page links to a given qa slug
grep -rl 'qa/how-does-incremental-ingest-work' wiki/
```

Classify as **warning**. Cap report at **top-10 most-orphaned** files (same cap as step 11) — full list available via manual grep. On a fresh vault where qa/ is not yet indexed, this is expected; warn without blocking.

**Fix suggestion:** Add the QA article to `wiki/index.md` under the `Q&A` category header, or link it from a relevant concept/entity page.

**14b — Frontmatter validator:**

For each `.md` file in `wiki/qa/`, parse YAML frontmatter and verify all 9 required fields per the v2 Q&A spec (§Q&A Articles in `references/wiki-schema.md`):

| Field | Required | Validation rule |
|-------|----------|-----------------|
| `tags` | yes | list; must include `qa` |
| `aliases` | yes | list; first entry = verbatim question |
| `question` | yes | non-empty string |
| `asked_at` | yes | non-empty string (ISO datetime) |
| `confidence` | yes | enum: `high`, `medium`, or `low` |
| `answer_summary` | yes | non-empty string |
| `sources` | yes | list (may be empty on draft articles) |
| `created` | yes | non-empty string (YYYY-MM-DD) |
| `updated` | yes | non-empty string (YYYY-MM-DD) |

Severity rules:
- Missing required field → **error**
- `confidence` value not in `[high, medium, low]` → **error**
- `sources` is not a list (e.g. bare string) → **error**
- YAML parse failure on a qa/ file → **error** (report as "unparseable frontmatter")

Pseudo-logic:

```
required_fields = [tags, aliases, question, asked_at, confidence,
                   answer_summary, sources, created, updated]
for file in glob("wiki/qa/*.md"):
    fm = parse_frontmatter(file)
    if parse_error:
        report(error, file, "unparseable frontmatter")
        continue
    missing = required_fields - fm.keys()
    if missing:
        report(error, file, f"missing fields: {missing}")
    if fm.confidence not in [high, medium, low]:
        report(error, file, "confidence must be high|medium|low")
    if not isinstance(fm.sources, list):
        report(error, file, "sources must be a list")
```

**14c — Index schema field check:**

Verify `wiki/index.md` YAML frontmatter contains `_schema: 2`:

- `_schema: 2` present → pass (v2 vault, fully migrated)
- `_schema` field absent → **info**: "v1→v2 migration pending; first `/wiki-ingest` run will set `_schema: 2`"
- `_schema` present but value ≠ `2` → **error**: "unexpected `_schema` value; expected `2`"

```bash
# Quick check for _schema field in index frontmatter
grep -m1 '_schema' wiki/index.md
```

**Anti-pattern note:** Steps 14a–14c report issues only — do **not** auto-fix. Orphan QA articles are resolved by updating `wiki/index.md` or adding wikilinks from related pages. Frontmatter errors are fixed by editing the qa/ file directly. Running `/wiki-ingest` will set `_schema: 2` automatically.

## Step 15: State.json Drift Detection

Validate `wiki/.state.json` for consistency between its recorded state and actual files on disk. Three sub-checks run in sequence.

**15c — Version check (run first):**

Read `wiki/.state.json`. If the file does not exist, report as **info** ("`.state.json` absent — no incremental state yet; will be created on first `/wiki-ingest` run") and skip the rest of step 15.

If the file exists:
- Parse as JSON; if invalid → **error** ("`.state.json` is not valid JSON; delete and re-run `/wiki-ingest` to regenerate")
- Check `version` field: if `version != 1` → **warning** ("unknown `.state.json` version; steps 15a–15b skipped to avoid false positives") and stop step 15
- `version == 1` → proceed to 15a and 15b

**15a — Orphan entries:**

For each key (relative path) in `state.files`:
- Check whether that path exists on disk relative to the vault root
- If the file no longer exists → flag as **warning**

```
Format: warning — .state.json: orphan entry "raw/old-article.md" (file deleted; re-run /wiki-ingest to clean up)
```

**Fix suggestion:** Re-run `/wiki-ingest` — it will detect the missing source and optionally prune the entry. Or manually edit `.state.json` to remove stale keys.

Pseudo-logic:

```
state = parse_json("wiki/.state.json")
for path, entry in state["files"].items():
    if not file_exists(vault_root / path):
        report(warning, ".state.json",
               f"orphan entry: '{path}' no longer exists on disk")
```

**15b — Dangling output references:**

For each entry in `state.files`, iterate over the `ingested_into` list:
- Check whether each listed wiki path exists on disk
- If a listed output file no longer exists → flag as **info**

```
Format: info — .state.json: dangling output "wiki/entities/old-entity.md" for source "raw/article.md" (output was deleted; re-ingest may be needed)
```

**Why info, not warning:** The output being absent doesn't corrupt state — it just means a wiki page was deleted after ingest. Re-running `/wiki-ingest` on that source will regenerate it if needed.

Pseudo-logic:

```
for path, entry in state["files"].items():
    for out in entry.get("ingested_into", []):
        if not file_exists(vault_root / out):
            report(info, ".state.json",
                   f"dangling output: '{out}' (source: '{path}') — output deleted; re-ingest if needed")
```

**Anti-pattern note:** Step 15 reports drift only — do **not** edit `.state.json` during lint. Run `/wiki-ingest` to refresh state, or `rm wiki/.state.json` to force a full re-ingest on the next run.

## Step 17: `.memory.log` Cross-Reference Audit (wiki-memory Only)

**When to run:** only if `<vault>/wiki/.memory.log` exists. If the file is absent, report as **info** ("wiki-memory not enabled for this vault; step 17 skipped") and stop. If `<vault>/raw/sessions/` does not exist, report as **info** ("no session captures yet; step 17 skipped") and stop.

**Log line format:** each line in `.memory.log` follows the pattern:

```
<iso8601_ts> <verb> <session_id> -> <filename>
```

Where `<verb>` is one of `session-end` or `pre-compact`. Regex: `^([0-9T:Z.-]+) (session-end|pre-compact) ([^ ]+) -> (.+\.md)$`

Lines that do not match this regex are corrupted entries — report as **warning**: `Step 17: unparseable log line: "<line>"`.

**Check 17a — Orphaned log entries:**

For each parseable line in `.memory.log`, extract `<filename>` (regex group 4). Verify that `<vault>/raw/sessions/<filename>` exists on disk. If the file is missing, report as **warning**:

```
Step 17: orphaned log entry — session=<session_id> verb=<verb> expected-file=raw/sessions/<filename> (was it deleted manually?)
```

Severity rationale: a missing capture file is data loss but not vault corruption. The user may have intentionally deleted it — hence warning, not error.

**Check 17b — Orphaned session files:**

Enumerate all `<vault>/raw/sessions/*.md` files. For each, search `.memory.log` for any line whose `<filename>` (group 4 basename) matches. If no log line references the file, report as **warning**:

```
Step 17: orphaned session file — raw/sessions/<filename> has no log entry (may be from external import or manual copy)
```

Match on basename only (strip path from the log entry filename if it contains a subdirectory component).

**Check 17c — Timestamp monotonicity:**

Read all parseable lines in order. Compare successive timestamps (group 1) as strings — ISO 8601 lexicographic order equals chronological order for the `YYYY-MM-DDTHH:MM:SSZ` subset used by these hooks. If any timestamp is strictly less than the preceding one, report as **error**:

```
Step 17: memory-log-timestamps-not-monotonic — line <N> timestamp <ts2> precedes line <N-1> timestamp <ts1> (log may be corrupted or manually edited)
```

Severity rationale: out-of-order timestamps indicate the log was tampered with or corrupted, which can break any audit tool relying on log ordering — error is appropriate.

**Check 17d — Duplicate session entries:**

While reading parseable lines, track `<session_id>` + `<verb>` pairs. If the same pair appears more than once, report as **warning**:

```
Step 17: duplicate log entry — session=<session_id> verb=<verb> appears <N> times (first: line <X>, last: line <Y>)
```

This catches double-writes that can occur if the mkdir-lock was bypassed (e.g. log rotated then restored).

**Output:** present findings as a flat bullet list under the `### Step 17 — .memory.log cross-reference` heading in the consolidated report. Use the same `error` / `warning` / `info` severity labels as other steps.

Example findings:

- `warning — Step 17: orphaned log entry — session=abc12345 verb=session-end expected-file=raw/sessions/2026-05-05-1234-abc12345.md`
- `warning — Step 17: orphaned session file — raw/sessions/pre-compact-2026-04-01-0900-xyz99999.md has no log entry`
- `error — Step 17: memory-log-timestamps-not-monotonic — line 42 timestamp 2026-04-30T09:00:00Z precedes line 41 timestamp 2026-05-01T08:00:00Z`
