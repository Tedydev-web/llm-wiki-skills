#!/usr/bin/env bash
# disable-hooks.sh — Remove wiki-memory lifecycle hooks from settings.json
# Usage: disable-hooks.sh [--scope global|project]
# Default scope: global
# Safe: only removes entries whose command path contains 'wiki-memory/scripts/hook-'.
# Preserves all other user-defined hooks. Leaves captured transcript files intact.
# Auto-compile: removes auto-compile.conf + worker-settings.json; removes cron line
#               and launchd plist if present; leaves queue dir intact for manual flush.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found — corrupted install?" >&2; exit 1; }

# Source shared helpers
# shellcheck source=lib-jq-merge.sh
source "$SCRIPT_DIR/lib-jq-merge.sh"
# shellcheck source=lib-vault-discovery.sh
source "$SCRIPT_DIR/lib-vault-discovery.sh"

# ── Argument parsing ───────────────────────────────────────────────────────────
SCOPE="global"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      SCOPE="${2:?--scope requires a value: global|project}"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--scope global|project]"
      echo ""
      echo "  --scope global   Remove hooks from ~/.claude/settings.json (default)"
      echo "  --scope project  Remove hooks from \$PWD/.claude/settings.json"
      exit 0
      ;;
    *)
      echo "[wiki-memory] ERROR: Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# Validate scope
case "$SCOPE" in
  global|project) ;;
  *)
    echo "[wiki-memory] ERROR: --scope must be 'global' or 'project', got: '$SCOPE'" >&2
    exit 1
    ;;
esac

# ── Dependency check ───────────────────────────────────────────────────────────
require_jq

# ── Resolve settings.json target ───────────────────────────────────────────────
SETTINGS_PATH="$(resolve_settings_path "$SCOPE")"
SETTINGS_DIR="$(dirname "$SETTINGS_PATH")"

if [[ ! -f "$SETTINGS_PATH" ]]; then
  echo "[wiki-memory] INFO: $SETTINGS_PATH does not exist — nothing to remove." >&2
else
  # ── Backup + lock ────────────────────────────────────────────────────────────
  BACKUP_PATH="$(backup_settings "$SETTINGS_PATH")"
  acquire_lockdir "$SETTINGS_DIR"

  echo "[wiki-memory] Removing wiki-memory hook entries from: $SETTINGS_PATH"
  remove_hook_entry "$SETTINGS_PATH" "wiki-memory/scripts/hook-"

  release_lockdir

  echo "[wiki-memory] Hooks removed."
  echo "  Backup: $BACKUP_PATH"
fi

# ── Remove sidecar config ──────────────────────────────────────────────────────
if [[ "$SCOPE" == "global" ]]; then
  _removed_any=0
  if [[ -f "$WIKI_NEW_SIDECAR" ]]; then
    rm -f "$WIKI_NEW_SIDECAR"
    echo "  Config removed: $WIKI_NEW_SIDECAR"
    _removed_any=1
  fi
  if [[ -f "$WIKI_OLD_SIDECAR_GLOBAL" ]]; then
    rm -f "$WIKI_OLD_SIDECAR_GLOBAL"
    echo "  Legacy config removed: $WIKI_OLD_SIDECAR_GLOBAL"
    _removed_any=1
  fi
  if [[ "$_removed_any" -eq 0 ]]; then
    echo "  Config not found (already removed or never enabled)"
  fi
else
  SIDECAR_FILE="$PWD/.claude/wiki-memory.conf"
  if [[ -f "$SIDECAR_FILE" ]]; then
    rm -f "$SIDECAR_FILE"
    echo "  Config removed: $SIDECAR_FILE"
  else
    echo "  Config not found (already removed or never enabled): $SIDECAR_FILE"
  fi
fi

# ── Auto-compile cleanup ───────────────────────────────────────────────────────
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wiki"
CONF_FILE="$CONF_DIR/auto-compile.conf"
WORKER_SETTINGS_FILE="$CONF_DIR/worker-settings.json"

if [[ -f "$CONF_FILE" ]]; then
  echo ""
  echo "[wiki-memory] Disabling auto-compile..."

  _platform="$(uname -s 2>/dev/null || echo Linux)"

  # ── Remove launchd plist (macOS) ──────────────────────────────────────────
  if [[ "$_platform" == "Darwin" ]]; then
    _plist_file="$HOME/Library/LaunchAgents/com.wiki-memory.compile.plist"
    if [[ -f "$_plist_file" ]]; then
      # Attempt graceful unload (ignore errors — plist may not be loaded)
      launchctl unload "$_plist_file" 2>/dev/null || true
      rm -f "$_plist_file"
      echo "  LaunchAgent removed: $_plist_file"
    else
      echo "  LaunchAgent not found (already removed or never installed)"
    fi
  fi

  # ── Remove cron line (Linux + macOS fallback) ─────────────────────────────
  if command -v crontab >/dev/null 2>&1; then
    # Remove any crontab line referencing the wiki-memory worker
    _current_cron="$(crontab -l 2>/dev/null || true)"
    if printf '%s\n' "$_current_cron" | grep -q "auto-compile-worker.sh"; then
      printf '%s\n' "$_current_cron" \
        | grep -v "auto-compile-worker.sh" \
        | crontab - 2>/dev/null || true
      echo "  Cron entry removed."
    else
      echo "  No cron entry found for wiki-memory worker."
    fi
  fi

  # ── Remove conf + worker settings ─────────────────────────────────────────
  rm -f "$CONF_FILE"
  echo "  Auto-compile config removed: $CONF_FILE"

  if [[ -f "$WORKER_SETTINGS_FILE" ]]; then
    rm -f "$WORKER_SETTINGS_FILE"
    echo "  Worker settings removed: $WORKER_SETTINGS_FILE"
  fi

  # ── Queue dir: leave intact for manual flush ───────────────────────────────
  # Discover vault to find queue dir path (best-effort)
  _vault="$(discover_vault 2>/dev/null || true)"
  if [[ -n "$_vault" && -d "$_vault/.queue" ]]; then
    _queue_depth=$(find "$_vault/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
    echo ""
    echo "  Queue directory preserved: $_vault/.queue/"
    if [[ "$_queue_depth" -gt 0 ]]; then
      echo "  WARNING: $_queue_depth pending job(s) remain in the queue."
      echo "  To discard: rm -rf $_vault/.queue/"
      echo "  To process manually: bash ${SCRIPT_DIR}/auto-compile-worker.sh --once"
    else
      echo "  Queue is empty."
    fi
  fi

  # M1 audit trail: cost-cap.state is intentionally NOT removed on disable.
  # Rationale: preserving the daily counter avoids resetting the budget if the user
  # re-enables within the same UTC day. File remains at mode 600 (set by cost-cap.sh
  # on creation); this script does not change its mode. Path is canonical:
  # ${XDG_CONFIG_HOME:-$HOME/.config}/wiki/cost-cap.state (matches cost-cap.sh).
  _cost_state_file="$CONF_DIR/cost-cap.state"
  echo ""
  if [[ -f "$_cost_state_file" ]]; then
    echo "  Note: cost-cap.state preserved at $_cost_state_file (audit trail, mode 600)."
  else
    echo "  Note: cost-cap.state not found at $_cost_state_file (never written or already removed)."
  fi
  echo "  To reset: rm -f $_cost_state_file"

else
  echo "  Auto-compile was not enabled (no conf file found)."
fi

# ── Final message ──────────────────────────────────────────────────────────────
echo ""
echo "[wiki-memory] Memory capture DISABLED."
echo "  Captured transcripts in raw/sessions/ are preserved — they were not deleted."
echo "  Re-enable anytime: /wiki-memory enable"
