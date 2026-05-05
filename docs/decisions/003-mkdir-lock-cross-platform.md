---
adr: 003
title: mkdir-based atomic lock for concurrent hook fires
status: accepted
date: 2026-05-05
---

# 003 — `mkdir`-based atomic lock

## Context

Multiple Claude Code sessions có thể fire hooks đồng thời (user mở 2 cửa sổ, hoặc parallel agent invocations). 3 chỗ cần atomic write:

1. `<vault>/wiki/.memory.log` (append-only ops log)
2. `<vault>/wiki/.state.json` (incremental ingest hash map)
3. `~/.claude/settings.json` (settings merge during enable/disable)

Concurrent writes không lock → race condition (lost writes, JSON corruption).

## Decision

**`mkdir`-based atomic lock pattern.** POSIX `mkdir` là atomic — nếu directory đã tồn tại, mkdir fail với non-zero exit. Pattern:

```bash
LOCK_DIR="$TARGET_FILE.lockdir"
ATTEMPTS=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [[ $ATTEMPTS -gt 50 ]] && { echo "lock timeout" >&2; exit 1; }
  sleep 0.1
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT INT TERM
# critical section
```

- Timeout: 5 seconds (50 × 100ms)
- `trap` cleanup on signal
- Lock dir name: `<target>.lockdir` (sibling to target)

## Consequences

**Positive:**
- Atomic on POSIX (Linux + macOS): `mkdir` syscall guarantees
- Cross-platform: works on macOS bash 3.2 (no flock dependency)
- Self-cleaning via trap on EXIT/INT/TERM
- Zero external dependency

**Negative:**
- SIGKILL (kill -9) bỏ qua trap → lock dir orphan → manual `rmdir` cần thiết
- Sleep-poll thay vì block-wait → ~50ms granularity
- Không reentrant (cùng process re-acquire = deadlock)

**Mitigations:**
- Stale lock detection: nếu lock dir > 60s old → force remove (heuristic, future enhancement)
- Document trong troubleshooting: `rm -rf <vault>/wiki/.memory.log.lockdir` if hung

## Alternatives rejected

- **`flock(1)`:** BSD/Linux có, macOS bash 3.2 KHÔNG có. Fail.
- **File mtime check:** Không atomic (TOCTOU race).
- **`ln -s` symlink:** Atomic nhưng filesystem-dependent (tmpfs có thể không support).
- **Database/Redis:** Overkill, vi phạm "zero deps" principle (ADR 002).
- **Skip locking:** Race conditions observed during P9 stress test với 5 parallel hooks.

## References

- Implementation: `skills/wiki-memory/scripts/lib-jq-merge.sh` — `acquire_lockdir`/`release_lockdir`
- Red-team finding F-5 forced this decision (proposed flock → rejected on macOS)
- Test coverage: `tests/wiki-memory/test-concurrent-locks.sh`
