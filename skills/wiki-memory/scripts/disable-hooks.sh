#!/usr/bin/env bash
# disable-hooks.sh — Remove wiki-memory lifecycle hooks from settings.json
# Usage: disable-hooks.sh [--scope global|project]
# Default scope: global
# Safe: only removes entries whose command path contains 'wiki-memory/scripts/hook-'.
# Preserves all other user-defined hooks. Leaves captured transcript files intact.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found — corrupted install?" >&2; exit 1; }

# Source shared helpers
# shellcheck source=lib-jq-merge.sh
source "$SCRIPT_DIR/lib-jq-merge.sh"

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
  # Still attempt sidecar cleanup below
else
  # ── Backup + lock ────────────────────────────────────────────────────────────
  BACKUP_PATH="$(backup_settings "$SETTINGS_PATH")"
  acquire_lockdir "$SETTINGS_DIR"

  # ── Remove hook entries matching our scripts ────────────────────────────────
  # Matches any command containing the canonical substring for our hook scripts.
  # This is safe: no user hook would plausibly use this path unless they added it
  # themselves, in which case they should edit settings.json manually.
  echo "[wiki-memory] Removing wiki-memory hook entries from: $SETTINGS_PATH"
  remove_hook_entry "$SETTINGS_PATH" "wiki-memory/scripts/hook-"

  release_lockdir

  echo "[wiki-memory] Hooks removed."
  echo "  Backup: $BACKUP_PATH"
fi

# ── Remove sidecar config ──────────────────────────────────────────────────────
if [[ "$SCOPE" == "global" ]]; then
  SIDECAR_FILE="$HOME/.config/wiki-memory/vault-path"
else
  SIDECAR_FILE="$PWD/.claude/wiki-memory.conf"
fi

if [[ -f "$SIDECAR_FILE" ]]; then
  rm -f "$SIDECAR_FILE"
  echo "  Config removed: $SIDECAR_FILE"
else
  echo "  Config not found (already removed or never enabled): $SIDECAR_FILE"
fi

# ── Final message ──────────────────────────────────────────────────────────────
echo ""
echo "[wiki-memory] Memory capture DISABLED."
echo "  Captured transcripts in raw/sessions/ are preserved — they were not deleted."
echo "  Re-enable anytime: /wiki-memory enable"
