#!/usr/bin/env bash
# cost-cap.sh — Daily invocation counter for wiki-memory auto-compile.
# Source this file: source "$(dirname "$0")/cost-cap.sh"
# Provides: cost_check(), cost_inc(), cost_reset()
#
# Counter file: ~/.config/wiki/cost-cap.state  (JSON, mode 600)
# Shape: {"date":"YYYY-MM-DD","count":N}
#   - date is UTC (date -u +%Y-%m-%d); supports WIKI_COST_NOW=YYYY-MM-DD override for tests.
#   - max is read from auto-compile.conf, NOT stored in the counter (F6: no duplication).
#
# Return code contract for cost_check / cost_inc / cost_reset (M3):
#   0 = OK (proceed)
#   1 = cap hit OR lock acquisition failure (caller should treat as ephemeral; may retry)
#   2 = reserved (not currently used; future: corruption detected — refuse run, manual recovery)
# Caller must use `if ! cost_check ...; then` (set -e safe) — bare invocation aborts script.
# NOTE: cost_check returns 1 on cap-hit; caller must not treat this as a fatal error.
#
# F6 hardening:
#   - Counter R-M-W under counter-specific lockdir <counter>.lockdir (separate from worker.lock)
#   - Corruption: if jq parse fails → refuse + log loud error → require manual rm. NEVER reset to 0.
#   - Stale lockdir recovery (>120s): mv to quarantine, proceed.
#
# C1/H3 trap-safety note:
#   _cost_acquire_lock does NOT install an EXIT trap (to avoid clobbering the caller's
#   EXIT trap, e.g., the worker's lock-release trap). All callers MUST call
#   _cost_release_lock explicitly in both success and failure paths.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+. Requires jq.

# ── Guard: prevent double-source ──────────────────────────────────────────────
[[ -n "${_WIKI_MEMORY_COST_CAP_LOADED:-}" ]] && return 0
readonly _WIKI_MEMORY_COST_CAP_LOADED=1

# ── Config path constants ─────────────────────────────────────────────────────
WIKI_COST_STATE_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/cost-cap.state"
_COST_LOCK_DIR="${WIKI_COST_STATE_FILE}.lockdir"

# ── _cost_today ───────────────────────────────────────────────────────────────
# Emit today's date in UTC YYYY-MM-DD. Respects WIKI_COST_NOW override for tests.
_cost_today() {
  if [[ -n "${WIKI_COST_NOW:-}" ]]; then
    printf '%s' "$WIKI_COST_NOW"
  else
    date -u +%Y-%m-%d
  fi
}

# ── _cost_acquire_lock ────────────────────────────────────────────────────────
# Acquire counter-specific lockdir with stale recovery (>120s → mv quarantine).
# Returns: 0 on acquired, 1 on timeout.
_cost_acquire_lock() {
  local attempts=0
  while ! mkdir "$_COST_LOCK_DIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    # After 40 attempts (20s), check if lock is stale (>120s old)
    if [[ $attempts -eq 40 ]]; then
      local lock_mtime now age
      if stat -c "%Y" "$_COST_LOCK_DIR" >/dev/null 2>&1; then
        # GNU stat (Linux)
        lock_mtime="$(stat -c "%Y" "$_COST_LOCK_DIR" 2>/dev/null)" || lock_mtime=0
      else
        # BSD stat (macOS)
        lock_mtime="$(stat -f "%m" "$_COST_LOCK_DIR" 2>/dev/null)" || lock_mtime=0
      fi
      now="$(date -u +%s)"
      age=$((now - lock_mtime))
      if [[ $age -gt 120 ]]; then
        local quarantine="${_COST_LOCK_DIR}.quarantine.$$"
        mv "$_COST_LOCK_DIR" "$quarantine" 2>/dev/null || true
        echo "[wiki-memory:cost-cap] WARN: stale counter lock ($age s old) quarantined to $quarantine" >&2
        continue
      fi
    fi
    if [[ $attempts -gt 60 ]]; then
      echo "[wiki-memory:cost-cap] ERROR: could not acquire counter lock after 30s" >&2
      return 1
    fi
    sleep 0.5
  done
  # NOTE: C1/H3 fix — do NOT install an EXIT trap here. All callers that need
  # lock cleanup must call _cost_release_lock explicitly (see cost_check, cost_inc,
  # cost_reset). Trap-based cleanup was removed because it clobbered the parent
  # shell's EXIT trap (e.g., the worker's "_release_worker_lock; exit" trap).
  return 0
}

# ── _cost_release_lock ────────────────────────────────────────────────────────
_cost_release_lock() {
  rmdir "$_COST_LOCK_DIR" 2>/dev/null || true
}

# ── _cost_read_counter ────────────────────────────────────────────────────────
# Read counter from state file. On corruption: prints loud error, returns 1.
# On missing file or date rollover: treats as count=0.
# Outputs: <date> <count> on stdout (two words).
_cost_read_counter() {
  local today
  today="$(_cost_today)"

  if [[ ! -f "$WIKI_COST_STATE_FILE" ]]; then
    printf '%s 0\n' "$today"
    return 0
  fi

  # Attempt jq parse
  local raw_date raw_count
  raw_date="$(jq -r '.date // empty' "$WIKI_COST_STATE_FILE" 2>/dev/null)" || raw_date=""
  raw_count="$(jq -r '.count // empty' "$WIKI_COST_STATE_FILE" 2>/dev/null)" || raw_count=""

  # Detect corruption: parse failure or non-numeric count
  if [[ -z "$raw_date" || -z "$raw_count" ]]; then
    echo "[wiki-memory:cost-cap] ERROR: cost-cap.state is corrupt or unreadable (F6)." >&2
    echo "  File: $WIKI_COST_STATE_FILE" >&2
    echo "  To unblock auto-compile, delete the file and the counter will reset:" >&2
    echo "    rm -f \"$WIKI_COST_STATE_FILE\"" >&2
    echo "  NEVER auto-reset — this would silently bypass the cost cap." >&2
    return 1
  fi

  # Validate count is a non-negative integer
  if [[ ! "$raw_count" =~ ^[0-9]+$ ]]; then
    echo "[wiki-memory:cost-cap] ERROR: cost-cap.state has non-numeric count='$raw_count' (F6 corruption)." >&2
    echo "  File: $WIKI_COST_STATE_FILE" >&2
    echo "  To unblock: rm -f \"$WIKI_COST_STATE_FILE\"" >&2
    return 1
  fi

  # Date rollover: new UTC day → treat as count=0
  if [[ "$raw_date" != "$today" ]]; then
    printf '%s 0\n' "$today"
    return 0
  fi

  printf '%s %s\n' "$raw_date" "$raw_count"
  return 0
}

# ── _cost_write_counter ───────────────────────────────────────────────────────
# Atomically write counter. Mode 600 enforced.
# Usage: _cost_write_counter <date> <count>
_cost_write_counter() {
  local the_date="$1"
  local the_count="$2"

  local state_dir="${WIKI_COST_STATE_FILE%/*}"
  umask 077
  mkdir -p "$state_dir" 2>/dev/null || true
  chmod 700 "$state_dir" 2>/dev/null || true

  local tmp_file="${WIKI_COST_STATE_FILE}.tmp.$$"
  jq -n --arg d "$the_date" --argjson c "$the_count" \
    '{"date":$d,"count":$c}' > "$tmp_file" 2>/dev/null || {
      rm -f "$tmp_file" 2>/dev/null
      echo "[wiki-memory:cost-cap] ERROR: jq failed writing counter state" >&2
      return 1
  }
  chmod 600 "$tmp_file" 2>/dev/null || true
  mv "$tmp_file" "$WIKI_COST_STATE_FILE"
  return 0
}

# ── cost_check ────────────────────────────────────────────────────────────────
# Check whether the daily cap allows another invocation.
# Usage: cost_check <max_invocations> <log_file>
# Returns: 0 if under cap, 1 if at/over cap or counter corrupt.
# On cap-hit: appends to <log_file>.
cost_check() {
  local max="$1"
  local log_file="${2:-/dev/null}"

  _cost_acquire_lock || return 1

  local counter_line date_val count_val
  counter_line="$(_cost_read_counter)" || {
    _cost_release_lock
    return 1
  }
  date_val="${counter_line%% *}"
  count_val="${counter_line##* }"

  _cost_release_lock

  if [[ "$count_val" -ge "$max" ]]; then
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s cost-cap-hit max=%s today=%s\n' "$ts" "$max" "$count_val" >> "$log_file" 2>/dev/null || true
    return 1
  fi

  return 0
}

# ── cost_inc ──────────────────────────────────────────────────────────────────
# Increment the counter by 1 under the counter lock.
# Usage: cost_inc
# Returns: 0 on success, 1 on lock/write failure or corruption.
cost_inc() {
  _cost_acquire_lock || return 1

  local counter_line date_val count_val
  counter_line="$(_cost_read_counter)" || {
    _cost_release_lock
    return 1
  }
  date_val="${counter_line%% *}"
  count_val="${counter_line##* }"

  local new_count
  new_count=$((count_val + 1))

  _cost_write_counter "$date_val" "$new_count" || {
    _cost_release_lock
    return 1
  }

  _cost_release_lock
  return 0
}

# ── cost_reset ────────────────────────────────────────────────────────────────
# Reset counter to 0 for today (used in tests and manual flush).
# Usage: cost_reset
cost_reset() {
  _cost_acquire_lock || return 1
  local today
  today="$(_cost_today)"
  _cost_write_counter "$today" 0 || {
    _cost_release_lock
    return 1
  }
  _cost_release_lock
  return 0
}
