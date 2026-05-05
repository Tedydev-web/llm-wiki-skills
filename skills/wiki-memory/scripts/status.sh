#!/usr/bin/env bash
# status.sh — Show wiki-memory hook registration state and last capture info
# Usage: status.sh
# Checks both global and project settings.json for our hook entries.
# Reports vault path, active hooks, capture count, last capture timestamp.
# Warns if last capture >7 days old while hooks are active (red-team F-6).
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found — corrupted install?" >&2; exit 1; }

source "$SCRIPT_DIR/lib-jq-merge.sh"

# ── Color helpers (only when stdout is a TTY) ──────────────────────────────────
_tty() { [[ -t 1 ]]; }

_color() {
  local code="$1"; shift
  if _tty; then printf '\033[%sm%s\033[0m' "$code" "$*"
  else printf '%s' "$*"
  fi
}

green()  { _color "0;32" "$*"; }
yellow() { _color "0;33" "$*"; }
red()    { _color "0;31" "$*"; }
bold()   { _color "1"    "$*"; }
cyan()   { _color "0;36" "$*"; }

# ── Dependency check ───────────────────────────────────────────────────────────
require_jq

# ── Vault discovery from sidecar config ───────────────────────────────────────
# Try global sidecar first, then project sidecar
VAULT_PATH=""
ACTIVE_SCOPE=""

GLOBAL_SIDECAR="$HOME/.config/wiki-memory/vault-path"

# Walk up from $PWD to find a project sidecar (`.claude/wiki-memory.conf`).
# Stops at filesystem root or $HOME (whichever first). Returns first match's path.
_discover_project_sidecar() {
  local dir="$PWD"
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if [[ -f "$dir/.claude/wiki-memory.conf" ]]; then
      echo "$dir/.claude/wiki-memory.conf"
      return 0
    fi
    [[ "$dir" == "$HOME" ]] && break
    dir="$(dirname "$dir")"
  done
  return 1
}

PROJECT_SIDECAR="$(_discover_project_sidecar 2>/dev/null || true)"

if [[ -f "$GLOBAL_SIDECAR" ]]; then
  VAULT_PATH="$(cat "$GLOBAL_SIDECAR")"
  VAULT_PATH="${VAULT_PATH/#\~/$HOME}"
  VAULT_PATH="${VAULT_PATH%/}"
  ACTIVE_SCOPE="global"
fi

if [[ -n "$PROJECT_SIDECAR" && -f "$PROJECT_SIDECAR" ]]; then
  # Project sidecar uses key=value format
  _proj_vault="$(grep '^vault-path=' "$PROJECT_SIDECAR" 2>/dev/null | cut -d= -f2- || true)"
  if [[ -n "$_proj_vault" ]]; then
    _proj_vault="${_proj_vault/#\~/$HOME}"
    _proj_vault="${_proj_vault%/}"
    # Project scope takes precedence if both exist (more specific)
    VAULT_PATH="$_proj_vault"
    ACTIVE_SCOPE="project"
  fi
fi

# ── Hook presence check in settings.json ──────────────────────────────────────
# Returns comma-separated list of events where our hooks are registered
_check_hooks_in_settings() {
  local settings_path="$1"
  local found_events=""

  [[ -f "$settings_path" ]] || return 0

  for event in SessionStart PreCompact SessionEnd; do
    local count
    count="$(jq --arg ev "$event" --arg sub "wiki-memory/scripts/hook-" '
      (.hooks[$ev] // [])
      | map(select(.hooks[0].command | test($sub; "")))
      | length
    ' "$settings_path" 2>/dev/null || echo 0)"
    if [[ "$count" -gt 0 ]]; then
      found_events="${found_events:+$found_events, }$event"
    fi
  done

  echo "$found_events"
}

GLOBAL_SETTINGS="$HOME/.claude/settings.json"
# Project settings.json sits next to project sidecar (same .claude/ dir if discovered)
if [[ -n "$PROJECT_SIDECAR" ]]; then
  PROJECT_SETTINGS="$(dirname "$PROJECT_SIDECAR")/settings.json"
else
  PROJECT_SETTINGS="$PWD/.claude/settings.json"
fi

GLOBAL_HOOKS="$(_check_hooks_in_settings "$GLOBAL_SETTINGS")"
PROJECT_HOOKS="$(_check_hooks_in_settings "$PROJECT_SETTINGS")"

# ── Determine overall enabled state ───────────────────────────────────────────
HOOKS_ACTIVE=0
HOOKS_SUMMARY=""

if [[ -n "$GLOBAL_HOOKS" && -n "$PROJECT_HOOKS" ]]; then
  HOOKS_ACTIVE=1
  HOOKS_SUMMARY="global ($GLOBAL_HOOKS) + project ($PROJECT_HOOKS)"
  echo ""
  echo "$(yellow "WARNING:") Hooks registered in BOTH global and project settings." >&2
  echo "  This may cause duplicate captures. Run '/wiki-memory disable --scope global'" >&2
  echo "  or '/wiki-memory disable --scope project' to clean up one scope." >&2
elif [[ -n "$GLOBAL_HOOKS" ]]; then
  HOOKS_ACTIVE=1
  HOOKS_SUMMARY="global: $GLOBAL_HOOKS"
elif [[ -n "$PROJECT_HOOKS" ]]; then
  HOOKS_ACTIVE=1
  HOOKS_SUMMARY="project: $PROJECT_HOOKS"
fi

# ── Capture stats ──────────────────────────────────────────────────────────────
CAPTURE_COUNT=0
LAST_CAPTURE_TS=""
LAST_CAPTURE_AGO=""
STALE_WARNING=0

if [[ -n "$VAULT_PATH" && -d "$VAULT_PATH" ]]; then
  # Count raw session capture files
  if [[ -d "$VAULT_PATH/raw/sessions" ]]; then
    CAPTURE_COUNT="$(find "$VAULT_PATH/raw/sessions" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')"
  fi

  # Read last log entry timestamp
  MEMORY_LOG="$VAULT_PATH/wiki/.memory.log"
  if [[ -f "$MEMORY_LOG" ]]; then
    # Last non-empty line of the log
    LAST_LOG_LINE="$(grep -v '^[[:space:]]*$' "$MEMORY_LOG" 2>/dev/null | tail -1 || true)"
    if [[ -n "$LAST_LOG_LINE" ]]; then
      # Extract ISO8601 timestamp — first field that looks like a date
      LAST_CAPTURE_TS="$(echo "$LAST_LOG_LINE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' | head -1 || true)"
      if [[ -z "$LAST_CAPTURE_TS" ]]; then
        # Fallback: first whitespace-delimited token
        LAST_CAPTURE_TS="$(echo "$LAST_LOG_LINE" | awk '{print $1}')"
      fi
    fi
  fi

  # Compute age + stale warning (red-team F-6)
  if [[ -n "$LAST_CAPTURE_TS" && "$HOOKS_ACTIVE" -eq 1 ]]; then
    # Convert timestamp to epoch seconds — cross-platform (macOS + Linux)
    _ts_clean="${LAST_CAPTURE_TS//T/ }"   # "2026-05-05 10:21:00"
    _ts_clean="${_ts_clean//Z/}"           # strip trailing Z

    _epoch_last=0
    if date -j >/dev/null 2>&1; then
      # macOS BSD date
      _epoch_last="$(date -j -f "%Y-%m-%d %H:%M:%S" "$_ts_clean" "+%s" 2>/dev/null || echo 0)"
    else
      # GNU date (Linux)
      _epoch_last="$(date -d "$_ts_clean" "+%s" 2>/dev/null || echo 0)"
    fi

    _epoch_now="$(date +%s)"
    _age_seconds=$(( _epoch_now - _epoch_last ))
    _age_days=$(( _age_seconds / 86400 ))

    if [[ "$_age_days" -ge 7 ]]; then
      STALE_WARNING=1
    fi

    # Human-readable age
    if [[ "$_age_days" -gt 1 ]]; then
      LAST_CAPTURE_AGO="${_age_days} days ago"
    elif [[ "$_age_days" -eq 1 ]]; then
      LAST_CAPTURE_AGO="1 day ago"
    else
      _age_hours=$(( _age_seconds / 3600 ))
      if [[ "$_age_hours" -gt 1 ]]; then
        LAST_CAPTURE_AGO="${_age_hours} hours ago"
      elif [[ "$_age_hours" -eq 1 ]]; then
        LAST_CAPTURE_AGO="1 hour ago"
      else
        _age_mins=$(( _age_seconds / 60 ))
        LAST_CAPTURE_AGO="${_age_mins} minutes ago"
      fi
    fi
  fi
fi

# ── Print formatted summary ────────────────────────────────────────────────────
echo ""
echo "$(bold "wiki-memory status")"
echo "─────────────────────────────────────────"

# Vault
if [[ -n "$VAULT_PATH" ]]; then
  echo "  $(bold "Vault:")         $VAULT_PATH"
else
  echo "  $(bold "Vault:")         $(yellow "not configured")  (run /wiki-memory enable)"
fi

# Hook state
if [[ "$HOOKS_ACTIVE" -eq 1 ]]; then
  echo "  $(bold "Hooks:")         $(green "active")  [$HOOKS_SUMMARY]"
else
  echo "  $(bold "Hooks:")         $(red "inactive")  (run /wiki-memory enable)"
fi

# Captures
echo "  $(bold "Total captures:") $CAPTURE_COUNT"

# Last capture
if [[ -n "$LAST_CAPTURE_TS" ]]; then
  echo "  $(bold "Last capture:")  $LAST_CAPTURE_TS  ($LAST_CAPTURE_AGO)"
else
  echo "  $(bold "Last capture:")  $(yellow "none recorded")"
fi

# Settings files checked
echo ""
echo "  $(bold "Settings checked:")"
if [[ -f "$GLOBAL_SETTINGS" ]]; then
  if [[ -n "$GLOBAL_HOOKS" ]]; then
    echo "    $(green "[active]")  $GLOBAL_SETTINGS"
  else
    echo "    [none]    $GLOBAL_SETTINGS"
  fi
else
  echo "    [absent]  $GLOBAL_SETTINGS"
fi
if [[ -f "$PROJECT_SETTINGS" ]]; then
  if [[ -n "$PROJECT_HOOKS" ]]; then
    echo "    $(green "[active]")  $PROJECT_SETTINGS"
  else
    echo "    [none]    $PROJECT_SETTINGS"
  fi
else
  echo "    [absent]  $PROJECT_SETTINGS  (run from vault dir for project scope)"
fi

echo "─────────────────────────────────────────"

# Stale capture warning (red-team F-6)
if [[ "$STALE_WARNING" -eq 1 ]]; then
  echo ""
  echo "  $(yellow "WARNING: Stale capture detected.")"
  echo "  Last activity was $(bold "$LAST_CAPTURE_AGO") ($LAST_CAPTURE_TS)"
  echo "  Hooks are registered but no recent captures were logged."
  echo "  Possible causes:"
  echo "    - No Claude Code sessions started since enable"
  echo "    - Hook scripts failing silently — check: /wiki-memory logs"
  echo "    - Vault path changed — re-run: /wiki-memory enable --vault <new-path>"
fi

echo ""
