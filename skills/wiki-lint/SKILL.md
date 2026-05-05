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

**Vault path:** read from `$WIKI_MEMORY_VAULT` env, else `cat ~/.config/wiki/sidecar.json | jq -r .vault_path`, else `cat ~/.config/wiki-memory/vault-path` (legacy), else ask user.

## Audit Steps Overview

Run all 17 checks, then present a consolidated report. Steps 1–13 are core; step 14 covers Q&A integrity; step 15 covers state.json drift; step 17 covers `.memory.log` cross-reference (wiki-memory only).

For full prose spec of every step:
`Read skills/wiki-lint/references/audit-steps.md`

### Quick step index

| Step | Check | Type |
|------|-------|------|
| 1 | Broken wikilinks | structural |
| 2 | Orphan pages | structural |
| 3 | Contradictions | LLM |
| 4 | Stale claims | LLM |
| 5 | Missing page wikilinks | structural |
| 6 | Missing cross-references | LLM |
| 7 | Index consistency | structural |
| 8 | Data gaps | LLM |
| 9 | Aliases consistency (L1a) | structural |
| 10 | Verification tags (L1b) | structural |
| 11 | Missing inline citations (L1c) | LLM-assisted |
| 12 | Sources-array completeness (F3) | structural |
| 13 | Regenerate wiki/cache.md (N1) | structural |
| 14a–c | Q&A artifact integrity | structural |
| 15a–c | State.json drift detection | structural |
| 17a–d | .memory.log cross-reference | structural |

For structural vs LLM classification and execution strategy:
`Read skills/wiki-lint/references/structural-vs-llm-checks.md`

## Running the Audit

1. Resolve vault path (above)
2. Read `skills/wiki-lint/references/audit-steps.md` for the full spec of each step
3. Execute structural steps first (fast, deterministic), then LLM steps
4. Collect all findings; group by severity (error / warning / info)
5. Present consolidated report — format spec in `skills/wiki-lint/references/audit-step-reporting-format.md`
6. Ask: "Found N errors, N warnings, N info items. Want me to fix any of these?"
7. Append lint entry to `wiki/log.md`

## When to Lint

- **After every 10 ingests** — catches cross-reference gaps while fresh
- **Monthly at minimum** — catches stale claims and orphan pages over time
- **Before major queries** — ensures wiki is healthy before relying on it for analysis

## References

- `skills/wiki-lint/references/audit-steps.md` — full prose for all 17 steps (one section each)
- `skills/wiki-lint/references/audit-step-reporting-format.md` — severity conventions, consolidated report structure, log format, quick-lint shell commands
- `skills/wiki-lint/references/structural-vs-llm-checks.md` — which steps are deterministic vs need LLM reasoning; execution strategy

## Related Skills

- `/wiki-ingest` — process new sources into wiki pages
- `/wiki-query` — ask questions against the wiki
