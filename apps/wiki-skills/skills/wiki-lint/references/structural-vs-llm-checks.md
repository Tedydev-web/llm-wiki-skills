---
title: "wiki-lint — Structural vs LLM Checks"
loaded_by: wiki-lint
---

# Structural vs LLM Checks

Classification of each audit step by execution mode: deterministic shell/grep (structural) vs reasoning-required (LLM).

## Structural Checks (Deterministic — Shell/Grep)

These steps produce exact pass/fail results without LLM reasoning. They can be automated via the quick-lint shell commands in `references/audit-step-reporting-format.md`.

| Step | Check | Method |
|------|-------|--------|
| 1 | Broken wikilinks | `grep` for `[[...]]` + file existence check |
| 2 | Orphan pages | Inbound link count per file |
| 5 | Missing page wikilinks | `[[...]]` targets with no file |
| 7 | Index consistency | File list vs index entries |
| 9 | Aliases consistency (L1a) | Frontmatter `aliases:` field + H1 exact match |
| 10 | Verification tags (L1b) | `grep -rn '[needs verification]'` |
| 12 | Sources-array completeness (F3) | Cross-reference entity `sources:` vs source page wikilinks |
| 14a | QA orphan detection | Inbound link count for `wiki/qa/*.md` |
| 14b | QA frontmatter validator | Required field presence + enum value check |
| 14c | Index schema field | `grep _schema wiki/index.md` |
| 15a | State.json orphan entries | Key existence check on disk |
| 15b | State.json dangling outputs | Output path existence check |
| 15c | State.json version check | JSON parse + `version` field read |
| 17a | Memory log orphaned entries | Log line → session file existence |
| 17b | Orphaned session files | Session file → log entry search |
| 17c | Timestamp monotonicity | Lexicographic string comparison of ISO 8601 timestamps |
| 17d | Duplicate session entries | session_id + verb pair deduplication |

## LLM Reasoning Checks

These steps require semantic understanding — pattern matching alone cannot determine correctness.

| Step | Check | Why LLM needed |
|------|-------|----------------|
| 3 | Contradictions | Determining whether two claims conflict requires semantic comparison |
| 4 | Stale claims | Requires reading source dates and assessing relevance to current content |
| 6 | Missing cross-references | Requires understanding topical overlap between pages |
| 8 | Data gaps | Requires assessing coverage quality against the domain |
| 11 | Missing inline citations (L1c) | Sentence boundary detection + citation pattern heuristic — structural grep is noisy; LLM reduces false positives |
| 13 | Cache regeneration | Requires summarizing recent log entries and identifying active themes |

## Execution Strategy

Run structural checks first (steps 1, 2, 5, 7, 9, 10, 12, 14, 15, 17) — they are fast and produce deterministic output. Then run LLM checks (steps 3, 4, 6, 8, 11, 13) where reasoning is needed.

For step 11 (inline citations), the quick-lint shell command provides a mechanical scan; LLM post-processes to drop false positives before reporting.

## When to Run Only Structural Checks

If the user asks for a "quick lint" or "fast health check", run only the structural steps. Skip steps 3, 4, 6, 8 entirely and run step 11 in shell-only mode (report raw count without LLM filtering). Step 13 (cache regeneration) is always run — it is mechanical and needed to keep cache current.
