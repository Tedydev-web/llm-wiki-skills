#!/usr/bin/env bash
# lib-jq-merge.sh — Shared helper library for wiki-memory manage scripts
# Source this file: source "$(dirname "$0")/lib-jq-merge.sh"
# Provides: require_jq, resolve_settings_path, backup_settings,
#           merge_hook_entry, remove_hook_entry, acquire_lockdir, release_lockdir
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+
# No external deps beyond jq (checked at runtime via require_jq)

# ── Guard: prevent double-source ──────────────────────────────────────────────
[[ -n "${_WIKI_MEMORY_LIB_JQ_MERGE_LOADED:-}" ]] && return 0
readonly _WIKI_MEMORY_LIB_JQ_MERGE_LOADED=1

# ── Internal state ─────────────────────────────────────────────────────────────
_LIB_LOCK_DIR=""

# ── require_jq ────────────────────────────────────────────────────────────────
# Exit 1 with install hint if jq is not on PATH.
require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "[wiki-memory] ERROR: jq is required but not found." >&2
    echo "  macOS:  brew install jq" >&2
    echo "  Linux:  sudo apt install jq   OR   sudo yum install jq" >&2
    exit 1
  fi
}

# ── resolve_settings_path ─────────────────────────────────────────────────────
# Usage: resolve_settings_path <scope>
# scope: "global" → ~/.claude/settings.json
#        "project" → $PWD/.claude/settings.json
# Prints the resolved path. Caller must mkdir -p the parent if needed.
resolve_settings_path() {
  local scope="${1:-global}"
  case "$scope" in
    global)  echo "$HOME/.claude/settings.json" ;;
    project) echo "$PWD/.claude/settings.json" ;;
    *)
      echo "[wiki-memory] ERROR: Unknown scope '$scope'. Use 'global' or 'project'." >&2
      exit 1
      ;;
  esac
}

# ── backup_settings ───────────────────────────────────────────────────────────
# Usage: backup_settings <settings_path>
# Creates a timestamped backup, then validates it with jq. Aborts on failure.
# Prints the backup path to stdout.
backup_settings() {
  local settings_path="$1"
  if [[ -z "$settings_path" ]]; then
    echo "[wiki-memory] ERROR: backup_settings requires a path argument." >&2
    exit 1
  fi

  # If settings.json doesn't exist yet, create a valid empty object so downstream jq works
  if [[ ! -f "$settings_path" ]]; then
    mkdir -p "$(dirname "$settings_path")"
    echo '{}' > "$settings_path"
  fi

  # Pre-validate source — abort if merge-conflict markers or invalid JSON detected
  if grep -qE '^(<{7}|>{7}|={7})' "$settings_path" 2>/dev/null; then
    echo "[wiki-memory] ERROR: $settings_path contains merge-conflict markers. Resolve manually." >&2
    exit 1
  fi
  if ! jq . "$settings_path" >/dev/null 2>&1; then
    echo "[wiki-memory] ERROR: $settings_path is not valid JSON. Aborting to protect your settings." >&2
    exit 1
  fi

  local timestamp
  timestamp="$(date +%Y%m%d-%H%M)"
  local backup_path="${settings_path}.bak.${timestamp}"

  cp "$settings_path" "$backup_path"

  # Validate backup integrity (red-team S-1)
  if ! jq . "$backup_path" >/dev/null 2>&1; then
    echo "[wiki-memory] ERROR: Backup validation failed — $backup_path is not valid JSON. Aborting." >&2
    rm -f "$backup_path"
    exit 1
  fi

  echo "$backup_path"
}

# ── merge_hook_entry ──────────────────────────────────────────────────────────
# Usage: merge_hook_entry <settings_path> <event_name> <command>
# Idempotent: removes any existing entry whose inner command matches <command>,
# then appends a fresh entry. Writes atomically via temp file.
merge_hook_entry() {
  local settings_path="$1"
  local event_name="$2"
  local command="$3"

  if [[ -z "$settings_path" || -z "$event_name" || -z "$command" ]]; then
    echo "[wiki-memory] ERROR: merge_hook_entry requires 3 arguments." >&2
    exit 1
  fi

  local new_entry
  new_entry="$(jq -n --arg cmd "$command" '{
    matcher: "",
    hooks: [{ type: "command", command: $cmd }]
  }')"

  local tmp_file="${settings_path}.wikimemory.tmp.$$"

  # jq: remove existing entry with same command (idempotent), then append fresh
  jq --arg event "$event_name" \
     --arg cmd "$command" \
     --argjson entry "$new_entry" '
    .hooks[$event] = (
      (.hooks[$event] // [])
      | map(select(
          .hooks[0].command != $cmd
        ))
      | . + [$entry]
    )
  ' "$settings_path" > "$tmp_file"

  # Validate output before replacing original
  if ! jq . "$tmp_file" >/dev/null 2>&1; then
    echo "[wiki-memory] ERROR: jq produced invalid JSON while merging $event_name. Original preserved." >&2
    rm -f "$tmp_file"
    exit 1
  fi

  mv "$tmp_file" "$settings_path"
}

# ── remove_hook_entry ─────────────────────────────────────────────────────────
# Usage: remove_hook_entry <settings_path> <command_path_substring>
# Removes all hook entries across ALL events whose command contains
# <command_path_substring>. Writes atomically via temp file.
remove_hook_entry() {
  local settings_path="$1"
  local cmd_substring="$2"

  if [[ -z "$settings_path" || -z "$cmd_substring" ]]; then
    echo "[wiki-memory] ERROR: remove_hook_entry requires 2 arguments." >&2
    exit 1
  fi

  if [[ ! -f "$settings_path" ]]; then
    # Nothing to remove
    return 0
  fi

  local tmp_file="${settings_path}.wikimemory.tmp.$$"

  # For each event key under .hooks, filter out entries matching our substring
  jq --arg sub "$cmd_substring" '
    if .hooks then
      .hooks |= with_entries(
        .value |= map(
          select(
            .hooks[0].command | test($sub; "") | not
          )
        )
        | select(.value | length > 0)
      )
    else .
    end
  ' "$settings_path" > "$tmp_file"

  # Validate before replacing
  if ! jq . "$tmp_file" >/dev/null 2>&1; then
    echo "[wiki-memory] ERROR: jq produced invalid JSON while removing entries. Original preserved." >&2
    rm -f "$tmp_file"
    exit 1
  fi

  mv "$tmp_file" "$settings_path"
}

# ── acquire_lockdir ───────────────────────────────────────────────────────────
# Usage: acquire_lockdir <settings_dir>
# Creates a lock directory. Sets _LIB_LOCK_DIR and registers EXIT trap.
# Exits 1 if another process holds the lock.
acquire_lockdir() {
  local settings_dir="$1"
  local lock_dir="${settings_dir}/.wiki-memory.lock"

  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo "[wiki-memory] ERROR: Another wiki-memory operation is in progress ($lock_dir)." >&2
    echo "  If this is stale, remove it: rmdir \"$lock_dir\"" >&2
    exit 1
  fi

  _LIB_LOCK_DIR="$lock_dir"
  # Register cleanup — uses variable captured at acquire time
  # shellcheck disable=SC2064
  trap "rmdir \"$_LIB_LOCK_DIR\" 2>/dev/null; trap - EXIT" EXIT
}

# ── release_lockdir ───────────────────────────────────────────────────────────
# Usage: release_lockdir
# Explicitly releases the lock acquired by acquire_lockdir. Normally the EXIT
# trap handles this, but call explicitly for clean semantics in long scripts.
release_lockdir() {
  if [[ -n "${_LIB_LOCK_DIR:-}" && -d "$_LIB_LOCK_DIR" ]]; then
    rmdir "$_LIB_LOCK_DIR" 2>/dev/null || true
    _LIB_LOCK_DIR=""
  fi
}
