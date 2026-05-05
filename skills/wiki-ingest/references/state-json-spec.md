---
title: "wiki-ingest — State JSON Spec"
loaded_by: wiki-ingest
---

# State JSON Spec

Detailed specification for `wiki/.state.json`: schema, hash algorithm, deduplication logic, atomic-write semantics, and concurrent access safety.

## Step 0: State Check (Incremental Ingest)

**Run this before processing any source.** Skips files that have not changed since last ingest.

### Load state

Read `wiki/.state.json`. If the file is missing or unreadable, treat state as empty and continue:

```json
{ "version": 1, "files": {} }
```

If the JSON is corrupt (parse error), log a warning — `⚠ wiki/.state.json is corrupt — treating as empty` — and proceed with a fresh state object. Never abort ingest due to a bad state file.

### Compute SHA256 for each candidate file

For each file in `raw/` (including `raw/sessions/`) that passed the "Identify Sources" step above:

```bash
# macOS (bash 3.2+)
sha256=$(shasum -a 256 "raw/example.md" | awk '{print $1}')

# Linux
sha256=$(sha256sum "raw/example.md" | awk '{print $1}')
```

If neither hash tool is available, fall back to mtime-based comparison with a warning: `⚠ SHA256 unavailable — using mtime fallback (less reliable)`.

### Skip or mark for ingest

For each candidate file:

- Look up `state.files["raw/example.md"]` (use relative path from vault root as key)
- If entry exists **and** `sha256` matches stored value → log `SKIP raw/example.md — unchanged since <ingested_at>` and remove from candidate list
- If entry exists **and** `sha256` differs → re-ingest; entry will be updated
- If no entry → ingest as new; entry will be created

### Track outputs during pipeline

As you create or update any wiki page (source, entity, concept, synthesis) during Steps 1-8 below, append the output path to a session-local list keyed to the source file:

```
session_outputs["raw/example.md"] += "wiki/concepts/foo.md"
```

This list is used in Step N (state write) below.

## Step N: State Write (Final)

**Run this after all sources have been processed** (after Step 8 for each source).

### Update state entries

For each file that was ingested (new or updated), write or overwrite its entry in `state.files`:

```json
"raw/example.md": {
  "sha256": "<computed hash>",
  "ingested_at": "<ISO-8601 timestamp, e.g. 2026-05-05T10:00:00Z>",
  "ingested_into": ["wiki/concepts/foo.md", "wiki/sources/example.md"]
}
```

`ingested_into` is the `session_outputs["raw/example.md"]` list accumulated during the pipeline.

### Schema version check (_schema migration)

On every run, ensure `wiki/index.md` frontmatter has `_schema: 2`. If missing or set to `1` (v1→v2 migration), update the frontmatter now and note it in the run report. This is a one-time migration guard; subsequent runs are a no-op.

### Atomic write

Write the updated state atomically to avoid partial writes:

```bash
# Write to temp file first
<write updated JSON to wiki/.state.json.tmp>

# Rename (atomic on POSIX; overwrites destination)
mv wiki/.state.json.tmp wiki/.state.json
```

If the rename fails, log an error but do NOT abort — ingest results are already written.

### Concurrent safety (mkdir-lock)

Before reading or writing `.state.json`, acquire a portable lock (no `flock` — macOS bash 3.2 incompatible):

```bash
# Acquire lock
lockdir="wiki/.state.json.lockdir"
until mkdir "$lockdir" 2>/dev/null; do
  sleep 0.2
done
trap 'rmdir "$lockdir"' EXIT

# ... read, compute, write .state.json ...

# Release lock (trap fires on exit too)
rmdir "$lockdir"
```

If the lock directory already exists after 10 retries (~2 s), log a warning and continue without locking (degraded mode, acceptable for single-user vaults).

### State maintenance (advanced users)

```bash
# Force full re-ingest (reset state)
rm <vault>/wiki/.state.json

# Inspect current state
jq . <vault>/wiki/.state.json

# List files skipped in last run (requires jq)
jq -r '.files | to_entries[] | select(.value.sha256 != null) | .key' <vault>/wiki/.state.json
```

> **Anti-pattern:** Do NOT manually edit `.state.json`. The file is maintained by `/wiki-ingest` and validated by `/wiki-lint` (P6 drift detection). Manual edits risk hash mismatches that cause phantom re-ingests or missed changes.
