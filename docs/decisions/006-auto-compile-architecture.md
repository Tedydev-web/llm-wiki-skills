---
adr: 006
title: Auto-compile architecture — external scheduler, 3-layer recursion guard, hardened FS safety
status: accepted
date: 2026-05-05
depends-on: [003, 004]
---

# 006 — Auto-Compile Architecture (v1.2)

## Context

ADR 004 deferred auto-compile (SessionEnd hook → automatic `/wiki-ingest` run) from v1.1 to v1.2,
citing recursion risk, cost runaway, and concurrent-ingest hazards. This ADR documents the
architecture chosen for the v1.2 implementation after red-team review + mandatory pre-impl spike.

**8 red-team findings (2026-05-05) reshaped the original design.** All 8 are baked into the
decisions below. The most critical was F3 (plan-fictional Layer 2 recursion guard), which
mandated a hard-gate spike before any implementation work began.

## Step 0 Spike Result (F3 — Mandatory Gate, 2026-05-05)

**Spike:** `tests/wiki-memory/spike/test-claude-p-env-propagation.sh`  
**Exit code:** 0 (PASS)  
**Outcome:** Env-var propagation through `claude -p` → SessionEnd hook is **confirmed real**.

Key findings from the spike:

1. `WIKI_SPIKE_MARKER` and `WIKI_MEMORY_INVOKED_BY` both appeared in the hook's environment
   when the parent process exported them before calling `claude -p`.
2. **Critical discovery:** `claude -p` does NOT read `.claude/settings.json` from its cwd.
   It reads settings from `--settings <file>` or from `~/.claude/settings.json` (global).
   **Consequence:** the worker MUST pass `--settings "$WIKI_SETTINGS_FILE"` when invoking
   `claude -p '/wiki-ingest'` to ensure the SessionEnd hook fires (and the recursion guard
   inside it is active). The wiki-memory enable flow writes a minimal settings file for this
   purpose at `~/.config/wiki/worker-settings.json`.
3. Layer 2 recursion guard design stands: env-var `WIKI_MEMORY_INVOKED_BY=1` set by worker
   before `claude -p` invocation propagates into the spawned session's hook and causes the
   hook to exit 0 without enqueuing. Verified empirically.

**P04 PROCEED** per validation 2026-05-05.

## Decision 1: External Scheduler (Cron + Launchd)

**Chosen:** Ship BOTH scheduler templates. Wizard auto-detects platform (`uname -s`) and
prints the appropriate snippet at enable-time. User installs with one copy-paste.

- **macOS:** launchd plist at `~/Library/LaunchAgents/com.wiki-memory.compile.plist`
- **Linux/macOS fallback:** crontab line via `crontab -l | { cat; echo "..."; } | crontab -`

Rejected alternative: in-process daemon. Would require PID file management, signal handling,
and log rotation (~200+ additional LOC). Violates KISS. External scheduler is supervised by
the OS at zero code cost.

## Decision 2: 3-Layer Recursion Guard

**Pre-condition:** Spike confirmed env-var inheritance is real (see above).

| Layer | Mechanism | Guards against |
|-------|-----------|----------------|
| 1 | `WIKI_MEMORY_INVOKED_BY=1` env-var | Worker's `claude -p` spawning sub-sessions that re-enqueue |
| 2 | Verified env-var inheritance (spike PASS) | Proves L1 actually works end-to-end through `claude -p` |
| 3 | Per-session `<vault>/.queue/<sid>.lock` mkdir-lock | Duplicate hook fires for the same session_id |

Layer 2 is not a separate mechanism — it is the spike result that gives Layer 1 its guarantee.
The original plan's "transcript-path argv inspection" (F3 finding) was removed; it was
plan-fictional since `claude -p` never sets `--transcript-path`.

**Rejected fallback:** filesystem `.in-flight` semaphore as automatic Layer-2 substitute.
Per validation 2026-05-05: if spike had failed, the correct action was to BLOCK release and
run `/ck:brainstorm` for a full redesign. Auto-pivoting to semaphore would re-introduce the
same plan-fiction anti-pattern (semaphore introduces its own race conditions needing explicit
research + plan). The spike passed, so this path was not needed.

## Decision 3: Cost-Cap Design (F6 Hardening)

Counter file: `~/.config/wiki/cost-cap.state` (JSON, mode 600).  
Shape: `{"date":"YYYY-MM-DD","count":N}` — no `.max` field (max is read from `auto-compile.conf`).

Key design choices:
- Counter R-M-W under a **counter-specific lockdir** `<counter>.lockdir` — separate from
  `.worker.lock` to avoid deadlock when worker holds its own lock and needs to update counter.
- **UTC date** (`date -u +%Y-%m-%d`) to avoid DST edge cases crossing midnight.
- `WIKI_COST_NOW=YYYY-MM-DD` env injection for deterministic test-time date override.
- **Corruption recovery:** if `jq` fails to parse counter, treat as `count=max`, refuse to run,
  log loud error to `.memory.log`, require user to delete the file manually.
  NEVER silently reset to 0 (that would bypass the cap, which is the exact failure mode F6
  identified). The error message includes the exact `rm` command to unblock.
- Counter rollover: if `date` field in counter != today's UTC date, reset `count=0`.

## Decision 4: Queue Back-Pressure (F11 Fix)

Back-pressure is applied on the **drain side only**, never the enqueue side.

- Hook always enqueues (no refusal). Reason: refusing on enqueue would require the hook to
  check queue depth, adding latency to every session end. Also, "PreCompact must always exit 0"
  constraint from ADR 004 applies by extension — hooks must be fast and non-blocking.
- Worker logs WARN at queue depth ≥ 50; logs ERROR and exits non-zero at ≥ 1000.
- Cost-cap orphans: when a job is blocked by the cap, worker writes a sibling `.cost-cap-hit`
  file. Next-day worker skips the fresh cap-check and retries the job. Orphan reaper after 7 days.

## Decision 5: FS-Safety Hardening (F8/F9/F10/F15)

| Finding | Fix |
|---------|-----|
| F8 (permissions) | `umask 077` at top of every script; `mkdir -m 700` for new dirs; `chmod 600` after every atomic write |
| F9 (symlink attack) | `[[ -L "$vault/.queue" ]]` check at hook + worker entry; refuse + log |
| F10 (path traversal) | `session_id =~ ^[a-zA-Z0-9-]+$` regex check at hook entry; exit 0 silently on fail |
| F15 (non-local FS) | Enable-time `stat -f` fs-type check; refuse if NFS/sshfs/SMB/FUSE/cloud-sync |

F15 rationale: ADR 003's `mkdir`-based atomic lock relies on POSIX `mkdir` syscall atomicity.
NFS, sshfs, SMB, and FUSE filesystems do not guarantee this. iCloud Drive and Dropbox add
upload-download delays that make stale-lock detection unreliable. These are unsupported as
vault locations for auto-compile native mode.

## Decision 6: `claude_bin` Resolution (F7)

`claude` binary path is resolved at enable-time via `command -v claude` and persisted in
`~/.config/wiki/auto-compile.conf`. The worker reads `claude_bin` from the conf file and uses
the absolute path for all `claude -p` invocations. This is critical because cron runs with a
minimal PATH that typically does not include nvm/pyenv/homebrew install locations.

## File Layout

```
~/.config/wiki/
├── sidecar.json                       (P01)
├── auto-compile.conf                  (mode 600; shell key=val)
├── cost-cap.state                     (mode 600; JSON counter)
└── worker-settings.json               (mode 600; minimal Claude settings for worker -p invocations)

<vault>/.queue/                        (mode 700)
├── <sanitized-sid>.json               (job spec, mode 600)
├── <sanitized-sid>.lock               (per-session mkdir lock, mode 700)
├── <sanitized-sid>.cost-cap-hit       (orphan marker, mode 600)
├── .worker.lock                       (worker singleton, mkdir-atomic)
└── .counter.lockdir                   (counter-specific lock, mkdir-atomic)
```

`auto-compile.conf` shape:
```
max_invocations_per_day=10
worker_timeout_seconds=300
claude_bin=/abs/path/to/claude
ingest_command=/wiki-ingest
```

## Consequences

**Positive:**
- External scheduler = zero daemon supervision code
- 3-layer recursion guard with empirically verified Layer 2
- Cost-cap with corruption-proof counter (no silent bypass)
- All 8 red-team findings addressed before first line of production code

**Negative:**
- Worker requires `--settings` flag on every `claude -p` invocation (discovered via spike)
- User must manually install cron/launchd snippet (one-time, copy-paste)
- NFS/cloud-sync vault paths unsupported for native mode (document clearly)

**Neutral:**
- `umask 077` + explicit mode enforcement is verbose but non-negotiable on shared hosts

## References

- Spike: `tests/wiki-memory/spike/test-claude-p-env-propagation.sh` (exit 0, 2026-05-05)
- ADR 003: mkdir-lock atomicity
- ADR 004: original auto-compile deferral rationale
- Phase-04 spec: `plans/260505-1335-llm-wiki-skills-v1-2-polish/phase-04-auto-compile-native.md`
- Red-team report: `plans/reports/red-team-260505-1335-llm-wiki-skills-v1-2-polish.md`
