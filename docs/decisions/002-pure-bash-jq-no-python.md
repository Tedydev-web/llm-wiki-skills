---
adr: 002
title: Pure bash + jq for hook scripts, no Python/Node/SDK
status: accepted
date: 2026-05-05
---

# 002 — Pure bash + jq

## Context

`wiki-memory` skill có 3 hook scripts chạy mỗi lần Claude Code session lifecycle event fire (SessionStart/PreCompact/SessionEnd). Constraints:

- Chạy **<2s** (PreCompact block compaction nếu chậm; SessionStart inject context)
- **Zero install friction** — user vừa cài skill phải chạy được ngay
- **Không recursion** vào Claude Code agent
- Cross-platform: macOS bash 3.2+ và Linux bash 4+

## Decision

**Pure bash + jq.** Không dùng Python, Node, uv, Claude Agent SDK, hay bất kỳ runtime nào khác.

- Hook scripts: `#!/usr/bin/env bash` + `jq` cho JSON parse/emit
- Shared lib: `extract-turns.sh` (transcript parser), `lib-jq-merge.sh` (settings.json idempotent merge)
- Hard-require `jq` ở enable time (fail-fast với install hint)

## Consequences

**Positive:**
- Zero runtime install (jq là dep duy nhất, có sẵn hoặc 1 dòng `brew/apt install`)
- Cold-start ~10-50ms (vs Python ~100-300ms)
- Đo được: 100-turn transcript parse trong 62ms
- Phù hợp với skills repo style (bash predominant)
- Không lock vào ecosystem version (pip/npm pin nightmare)

**Negative:**
- String handling phức tạp hơn (special chars, paths với spaces phải quote everywhere)
- jq syntax learning curve cho contributors mới
- Không có structured error handling (chỉ exit codes + stderr)

**Neutral:**
- bash 3.2 lacks `flock`, `mapfile`, associative arrays → workaround patterns documented (xem ADR 003)

## Alternatives rejected

- **Python:** Cold-start overhead vi phạm <2s budget; pip install friction; venv complexity
- **Node:** Overkill cho task này; npm install không thể assume on user systems
- **Claude Agent SDK:** Recursion nightmare (hook spawn `claude` → fire hook → loop); deferred to v1.2 với proper safeguards (xem ADR 004)
- **Hybrid bash + small Python helper:** Worst of both worlds

## References

- Performance budget enforced trong [contributing.md](../contributing.md) testing section
- bash 3.2 patterns documented inline trong scripts
- jq defensive parse pattern: `jq -r '.field // empty'` (red-team A-2)
