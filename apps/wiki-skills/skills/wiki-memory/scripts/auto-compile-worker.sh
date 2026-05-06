#!/usr/bin/env bash
# auto-compile-worker.sh — Drain <vault>/.queue/ and invoke wiki-ingest per job.
# Usage: auto-compile-worker.sh [--once]
#   --once: drain queue once then exit (same worker.lock semantics as cron mode)
#
# Invoked by cron or launchd. Never invoked directly during a user session.
# Reads config from ~/.config/wiki/auto-compile.conf (written by enable-hooks.sh).
#
# Concurrency invariants:
#   - Worker singleton via <vault>/.queue/.worker.lock (mkdir-atomic, ADR 003)
#   - Per-session uniqueness via <vault>/.queue/<sid>.lock (written by hook)
#   - Counter atomicity via <counter>.lockdir (separate from worker.lock)
#
# F6: stale .worker.lock (>50min) → mv to quarantine dir, proceed.
# F7: reads claude_bin absolute path from conf (resolved at enable-time).
# F8: umask 077 + explicit chmod 600/700.
# F9: symlink check on .queue/ at startup.
# F11: warn at depth>=50, error+exit at depth>=1000.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+. Requires jq.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source helpers
# shellcheck source=lib-fs-safety.sh
source "$SCRIPT_DIR/lib-fs-safety.sh"
# shellcheck source=cost-cap.sh
source "$SCRIPT_DIR/cost-cap.sh"
# shellcheck source=lib-vault-discovery.sh
source "$SCRIPT_DIR/lib-vault-discovery.sh"

# ── Config paths ──────────────────────────────────────────────────────────────
CONF_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/auto-compile.conf"
WORKER_SETTINGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/worker-settings.json"

# ── Parse arguments ───────────────────────────────────────────────────────────
ONCE_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) ONCE_MODE=true; shift ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--once]"
      echo "  --once  Drain queue once then exit (default: run until queue empty)"
      exit 0
      ;;
    *)
      echo "[wiki-memory:worker] ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ── Load config ───────────────────────────────────────────────────────────────
if [[ ! -f "$CONF_FILE" ]]; then
  echo "[wiki-memory:worker] INFO: auto-compile not enabled (no conf at $CONF_FILE); exiting." >&2
  exit 0
fi

# Source conf as shell key=val (mode 600; values set at enable-time)
# shellcheck source=/dev/null
source "$CONF_FILE"

: "${max_invocations_per_day:=10}"
: "${worker_timeout_seconds:=300}"
: "${claude_bin:=}"
: "${ingest_command:=/wiki-ingest}"

if [[ -z "$claude_bin" || ! -x "$claude_bin" ]]; then
  echo "[wiki-memory:worker] ERROR: claude_bin not set or not executable: '$claude_bin'" >&2
  echo "  Re-run: wiki-memory enable --auto-compile native" >&2
  exit 1
fi

# ── Discover vault ────────────────────────────────────────────────────────────
vault="$(discover_vault 2>/dev/null || true)"
if [[ -z "$vault" ]]; then
  echo "[wiki-memory:worker] ERROR: vault not configured; exiting." >&2
  exit 1
fi

QUEUE_DIR="$vault/.queue"
LOG_FILE="$vault/wiki/.memory.log"

# Ensure log dir exists
mkdir -p "$vault/wiki"

_log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s %s\n' "$ts" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# ── F9: symlink check on .queue/ ──────────────────────────────────────────────
if [[ -e "$QUEUE_DIR" ]]; then
  if ! check_no_symlink "$QUEUE_DIR" ".queue/"; then
    _log "worker-abort reason=symlink-attack path=$QUEUE_DIR"
    echo "[wiki-memory:worker] ERROR: $QUEUE_DIR is a symlink; refusing to operate (F9)" >&2
    exit 1
  fi
fi

# C2/F9: second guard before mkdir — if .queue became a symlink between the check
# above and the mkdir call (TOCTOU window), refuse rather than create under it.
if [[ -L "$QUEUE_DIR" ]]; then
  _log "worker-abort reason=symlink-at-mkdir path=$QUEUE_DIR"
  echo "[wiki-memory:worker] ERROR: $QUEUE_DIR is a symlink (detected pre-mkdir); refusing (F9)" >&2
  exit 1
fi

# Ensure queue dir exists with secure permissions
mkdir -p "$QUEUE_DIR" 2>/dev/null || true
chmod 700 "$QUEUE_DIR" 2>/dev/null || true
set_secure_perms "$QUEUE_DIR" dir

# ── Worker singleton lock (.worker.lock) ──────────────────────────────────────
WORKER_LOCK="$QUEUE_DIR/.worker.lock"

_acquire_worker_lock() {
  if mkdir "$WORKER_LOCK" 2>/dev/null; then
    # Register cleanup trap
    # shellcheck disable=SC2064
    trap "_release_worker_lock; exit" EXIT INT TERM
    return 0
  fi

  # Lock exists — check staleness (>50min = 3000s)
  local lock_mtime now age
  if stat -c "%Y" "$WORKER_LOCK" >/dev/null 2>&1; then
    lock_mtime="$(stat -c "%Y" "$WORKER_LOCK" 2>/dev/null)" || lock_mtime=0
  else
    lock_mtime="$(stat -f "%m" "$WORKER_LOCK" 2>/dev/null)" || lock_mtime=0
  fi
  now="$(date -u +%s)"
  age=$((now - lock_mtime))

  if [[ $age -gt 3000 ]]; then
    local quarantine="$QUEUE_DIR/.worker.lock.quarantine.$$"
    mv "$WORKER_LOCK" "$quarantine" 2>/dev/null || true
    _log "worker-lock-stale-recovered age=${age}s quarantine=$quarantine"
    echo "[wiki-memory:worker] WARN: stale worker lock (${age}s old) quarantined" >&2
    if mkdir "$WORKER_LOCK" 2>/dev/null; then
      # shellcheck disable=SC2064
      trap "_release_worker_lock; exit" EXIT INT TERM
      return 0
    fi
  fi

  echo "[wiki-memory:worker] INFO: another worker is running (lock exists); exiting." >&2
  exit 0
}

_release_worker_lock() {
  rmdir "$WORKER_LOCK" 2>/dev/null || true
}

_acquire_worker_lock

# ── F11: queue depth checks ───────────────────────────────────────────────────
_check_queue_depth() {
  local depth
  # Count .json files (not .cost-cap-hit or .lock dirs)
  depth=$(find "$QUEUE_DIR" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$depth" -ge 1000 ]]; then
    _log "worker-abort reason=queue-overflow depth=$depth"
    echo "[wiki-memory:worker] ERROR: queue depth $depth >= 1000; operator intervention needed" >&2
    echo "  Queue: $QUEUE_DIR" >&2
    exit 1
  fi
  if [[ "$depth" -ge 50 ]]; then
    _log "worker-warn depth=$depth"
    echo "[wiki-memory:worker] WARN: queue depth $depth >= 50" >&2
  fi
}

_check_queue_depth

# ── Worker settings file for claude -p --settings ─────────────────────────────
# The SessionEnd hook inside the spawned claude -p session needs to see
# wiki-memory hooks so the recursion guard (WIKI_MEMORY_INVOKED_BY=1) can fire.
# We pass --settings pointing at the global settings so hooks are loaded.
# If worker-settings.json was written by enable-hooks.sh, use that; else fall
# back to the global ~/.claude/settings.json.
if [[ ! -f "$WORKER_SETTINGS_FILE" ]]; then
  WORKER_SETTINGS_FILE="$HOME/.claude/settings.json"
fi
if [[ ! -f "$WORKER_SETTINGS_FILE" ]]; then
  # No settings at all — create a minimal empty-hooks file so -p doesn't error
  mkdir -p "$(dirname "$WORKER_SETTINGS_FILE")" 2>/dev/null || true
  chmod 700 "$(dirname "$WORKER_SETTINGS_FILE")" 2>/dev/null || true
  printf '{"hooks":{}}\n' > "$WORKER_SETTINGS_FILE"
  chmod 600 "$WORKER_SETTINGS_FILE" 2>/dev/null || true
fi

# ── Drain loop ────────────────────────────────────────────────────────────────
_log "worker-start mode=$( [[ "$ONCE_MODE" == true ]] && echo once || echo cron )"

processed=0
skipped_cap=0

for job_file in "$QUEUE_DIR"/*.json; do
  # glob may expand to literal '*.json' if no files exist
  [[ -e "$job_file" ]] || break

  job_base="${job_file%.json}"

  # Skip if cost-cap-hit sibling exists (orphan from previous day)
  cap_hit_marker="${job_base}.cost-cap-hit"
  if [[ -f "$cap_hit_marker" ]]; then
    # Check if today's cap allows retry (marker is from a previous day)
    local_today="$(_cost_today)"
    marker_date="$(jq -r '.cap_hit_date // empty' "$cap_hit_marker" 2>/dev/null)" || marker_date=""
    if [[ -n "$marker_date" && "$marker_date" == "$local_today" ]]; then
      # Still same day — skip
      skipped_cap=$((skipped_cap + 1))
      continue
    else
      # Different day — remove marker and retry
      rm -f "$cap_hit_marker" 2>/dev/null || true
    fi
  fi

  # Read session_id from job file
  sid="$(jq -r '.session_id // empty' "$job_file" 2>/dev/null)" || sid=""

  # Validate session_id
  if ! sanitize_session_id "$sid"; then
    _log "worker-skip reason=bad-session-id file=$(basename "$job_file")"
    rm -f "$job_file" 2>/dev/null || true
    continue
  fi

  # F9: check per-session lock dir (created by hook; still present = hook wrote it)
  sid_lock="$QUEUE_DIR/${sid}.lock"

  # Cost-cap check (under counter lock)
  if ! cost_check "$max_invocations_per_day" "$LOG_FILE"; then
    # Write orphan marker with today's date so next-day worker can retry
    local_today="$(_cost_today)"
    jq -n --arg d "$local_today" '{"cap_hit_date":$d}' > "$cap_hit_marker" 2>/dev/null || true
    chmod 600 "$cap_hit_marker" 2>/dev/null || true
    skipped_cap=$((skipped_cap + 1))
    _log "worker-cap-orphan session_id=$sid file=$(basename "$job_file")"
    continue
  fi

  # Increment counter before invocation (prevents over-spend on concurrent workers)
  if ! cost_inc; then
    _log "worker-skip reason=counter-inc-failed session_id=$sid"
    continue
  fi

  # Invoke ingest — set recursion guard env-var so hook inside spawned session exits early
  # H2 fix: claude -p reads positional args as prompt segments. Pass ingest_command and
  # --session-id as separate argv items (NOT as a single quoted string). Verified via spike
  # that `claude -p '/wiki-ingest' --session-id abc` parses correctly as one prompt token
  # with an explicit named flag. Do NOT use "$ingest_command --session-id $sid" (one argv).
  _log "worker-invoke session_id=$sid command=$ingest_command"
  invoke_ok=true
  ec=0
  WIKI_MEMORY_INVOKED_BY=1 \
    "$claude_bin" -p \
      --settings "$WORKER_SETTINGS_FILE" \
      "$ingest_command" \
      --session-id "$sid" \
      >/dev/null 2>&1 || ec=$?
  # H1 fix: capture exit code immediately after the command, not after the if-check
  if [[ $ec -ne 0 ]]; then
    invoke_ok=false
    _log "worker-invoke-fail session_id=$sid exit=$ec"
  fi

  if [[ "$invoke_ok" == true ]]; then
    # Cleanup: remove job file and per-session lock
    rm -f "$job_file" 2>/dev/null || true
    rm -rf "$sid_lock" 2>/dev/null || true
    processed=$((processed + 1))
    _log "worker-done session_id=$sid"
  else
    # Leave job file for retry next cycle; leave per-session lock too
    _log "worker-retry-pending session_id=$sid"
  fi
done

# Orphan reaper: remove cap-hit markers older than 7 days
find "$QUEUE_DIR" -maxdepth 1 -name '*.cost-cap-hit' -mtime +7 -delete 2>/dev/null || true

_log "worker-exit processed=$processed skipped_cap=$skipped_cap"

_release_worker_lock
trap - EXIT INT TERM
exit 0
