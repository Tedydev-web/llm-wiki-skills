---
title: "wiki-lint — Audit Step Reporting Format"
loaded_by: wiki-lint
---

# Audit Step Reporting Format

`WARN`/`ERROR`/`INFO` conventions, severity classification, and machine-parseable output schema for the consolidated lint report.

## Severity Levels

| Severity | Label | Meaning |
|----------|-------|---------|
| Error | `error` | Must fix — blocks correctness or causes data loss |
| Warning | `warning` | Should fix — degrades quality or indicates drift |
| Info | `info` | Nice to fix — improvement opportunity, not urgent |

## Consolidated Report Structure

Present findings grouped by severity after all steps complete:

### Errors (must fix)
- Broken wikilinks
- Contradictions between pages
- Index entries pointing to missing pages
- Aliases missing or mismatched (L1a, step 9)
- Sources-array missing source refs (F3, step 12)
- QA articles with missing required frontmatter fields (step 14b)
- QA articles with invalid `confidence` value (step 14b)
- `_schema` field present but wrong value in `wiki/index.md` (step 14c)
- `.state.json` is not valid JSON (step 15c)
- `.memory.log` timestamps not monotonic — log corruption (step 17c)

### Warnings (should fix)
- Orphan pages with no inbound links
- Stale claims from outdated sources
- Missing pages for frequently referenced topics
- `[needs verification]` flags pending research (L1b, step 10)
- QA articles with no inbound links — top-10 cap (step 14a)
- `.state.json` entries referencing deleted source files (step 15a)
- `.state.json` version unknown (step 15c)
- `.memory.log` entries referencing missing capture files (step 17a)
- Session capture files with no `.memory.log` entry (step 17b)
- Duplicate session entries in `.memory.log` (step 17d)
- Unparseable lines in `.memory.log` (step 17, format mismatch)

### Info (nice to fix)
- Potential cross-references to add
- Data gaps that could be filled
- Index entries that could be more descriptive
- Suspected missing inline citations (L1c, step 11) — top-10 pages only
- `_schema` field absent from `wiki/index.md` — v1→v2 migration pending (step 14c)
- `.state.json` absent — no incremental state yet (step 15c)
- `.state.json` entries with deleted output files (step 15b)
- wiki-memory not enabled — step 17 skipped (`.memory.log` absent)
- No session captures yet — step 17 skipped (`raw/sessions/` absent)

## Per-Finding Format

For each finding, include:
- **What:** description of the issue
- **Where:** the specific file(s) and line(s)
- **Fix:** what to do about it

## Log Entry Format

Append to `wiki/log.md` after the audit:

    ## [YYYY-MM-DD] lint | Health check
    Found N errors (B broken, A aliases, S sources-incomplete, Q qa-frontmatter, T memory-log-ts), M warnings (V verification flags, O qa-orphans, D state-drift, L memory-log-orphans, ...), K info items.
    Regenerated wiki/cache.md.
    Fixed: [list of fixes applied].

## After the Report

Ask the user:
> "Found N errors, N warnings, and N info items. Want me to fix any of these?"

If the user agrees, fix issues and report what changed.

## Quick-Lint Shell Commands

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

# Step 14a: find wiki/qa/ files with no inbound links from any wiki page
for f in wiki/qa/*.md; do
  slug=$(basename "$f" .md)
  grep -rl "$slug" wiki/ | grep -v "^$f$" | grep -q . || echo "ORPHAN qa: $f"
done

# Step 14b: qa/ files missing required frontmatter fields (quick check for 'confidence:')
for f in wiki/qa/*.md; do
  grep -q '^confidence:' "$f" || echo "MISSING confidence: $f"
done

# Step 14c: _schema field in wiki/index.md
grep -m1 '_schema' wiki/index.md || echo "INFO: _schema absent from wiki/index.md"

# Step 15c: state.json version
python3 -c "import json,sys; d=json.load(open('wiki/.state.json')); print('version:', d.get('version'))" 2>/dev/null || echo "INFO: wiki/.state.json absent or invalid"

# Step 15a: orphan entries in state.json (sources no longer on disk)
python3 -c "
import json, os
d = json.load(open('wiki/.state.json'))
for p in d.get('files', {}):
    if not os.path.exists(p):
        print('ORPHAN state entry:', p)
" 2>/dev/null
```
