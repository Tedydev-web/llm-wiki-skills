#!/usr/bin/env bash
# enable-hooks.sh — Register wiki-memory lifecycle hooks into settings.json
# Usage: enable-hooks.sh [--scope global|project] [--vault <path>]
# Default scope: global
# Idempotent: safe to run multiple times — produces exactly 3 hook entries.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Verify we are running from within the skill tree
[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found — corrupted install?" >&2; exit 1; }

# Source shared helpers
# shellcheck source=lib-jq-merge.sh
source "$SCRIPT_DIR/lib-jq-merge.sh"

# ── Argument parsing ───────────────────────────────────────────────────────────
SCOPE="global"
VAULT_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      SCOPE="${2:?--scope requires a value: global|project}"
      shift 2
      ;;
    --vault)
      VAULT_ARG="${2:?--vault requires a path argument}"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--scope global|project] [--vault <path>]"
      echo ""
      echo "  --scope global   Register hooks in ~/.claude/settings.json (default)"
      echo "  --scope project  Register hooks in \$PWD/.claude/settings.json"
      echo "  --vault <path>   Path to your LLM Wiki vault (overrides WIKI_MEMORY_VAULT env)"
      exit 0
      ;;
    *)
      echo "[wiki-memory] ERROR: Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# Validate scope value
case "$SCOPE" in
  global|project) ;;
  *)
    echo "[wiki-memory] ERROR: --scope must be 'global' or 'project', got: '$SCOPE'" >&2
    exit 1
    ;;
esac

# ── Dependency check ───────────────────────────────────────────────────────────
require_jq

# ── Vault discovery ────────────────────────────────────────────────────────────
# Priority: --vault arg → WIKI_MEMORY_VAULT env → prompt user
VAULT_PATH=""

if [[ -n "$VAULT_ARG" ]]; then
  VAULT_PATH="$VAULT_ARG"
elif [[ -n "${WIKI_MEMORY_VAULT:-}" ]]; then
  VAULT_PATH="$WIKI_MEMORY_VAULT"
else
  # Interactive prompt — only works if stdin is a TTY
  if [[ -t 0 ]]; then
    echo "[wiki-memory] Vault path not set. Enter the absolute path to your LLM Wiki vault:"
    read -r VAULT_PATH
  else
    echo "[wiki-memory] ERROR: Vault path not provided." >&2
    echo "  Use --vault <path> or set WIKI_MEMORY_VAULT env variable." >&2
    exit 1
  fi
fi

# Expand ~ in path (macOS bash 3.2 safe)
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"
# Remove trailing slash
VAULT_PATH="${VAULT_PATH%/}"

# ── Vault validation ───────────────────────────────────────────────────────────
if [[ ! -d "$VAULT_PATH" ]]; then
  echo "[wiki-memory] ERROR: Vault directory does not exist: $VAULT_PATH" >&2
  echo "  Run '/wiki' first to initialize your vault." >&2
  exit 1
fi

if [[ ! -d "$VAULT_PATH/wiki" ]]; then
  echo "[wiki-memory] ERROR: Vault is missing 'wiki/' directory: $VAULT_PATH" >&2
  echo "  Expected layout: $VAULT_PATH/wiki/  Run '/wiki' to initialize." >&2
  exit 1
fi

# ── Resolve settings.json target ───────────────────────────────────────────────
SETTINGS_PATH="$(resolve_settings_path "$SCOPE")"
SETTINGS_DIR="$(dirname "$SETTINGS_PATH")"
mkdir -p "$SETTINGS_DIR"

# ── Backup + lock ──────────────────────────────────────────────────────────────
BACKUP_PATH="$(backup_settings "$SETTINGS_PATH")"
acquire_lockdir "$SETTINGS_DIR"

# ── Register 3 lifecycle hooks ─────────────────────────────────────────────────
# Use absolute, resolved skill path (not $HOME expansion) so entries work from any CWD
HOOKS_SCRIPT_DIR="$SCRIPT_DIR"

echo "[wiki-memory] Registering hooks in: $SETTINGS_PATH"

merge_hook_entry "$SETTINGS_PATH" "SessionStart" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-session-start.sh"

merge_hook_entry "$SETTINGS_PATH" "PreCompact" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-pre-compact.sh"

merge_hook_entry "$SETTINGS_PATH" "SessionEnd" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-session-end.sh"

# ── Write vault sidecar config ─────────────────────────────────────────────────
if [[ "$SCOPE" == "global" ]]; then
  SIDECAR_DIR="$HOME/.config/wiki-memory"
  SIDECAR_FILE="$SIDECAR_DIR/vault-path"
  # red-team A-5: mkdir -p BEFORE writing sidecar
  mkdir -p "$SIDECAR_DIR"
  echo "$VAULT_PATH" > "$SIDECAR_FILE"
else
  # Project scope: store adjacent to project's .claude directory
  SIDECAR_DIR="$PWD/.claude"
  SIDECAR_FILE="$SIDECAR_DIR/wiki-memory.conf"
  mkdir -p "$SIDECAR_DIR"
  echo "vault-path=$VAULT_PATH" > "$SIDECAR_FILE"
fi

release_lockdir

# ── Ensure raw/sessions directory exists in vault ──────────────────────────────
mkdir -p "$VAULT_PATH/raw/sessions"

# ── Success output ─────────────────────────────────────────────────────────────
echo ""
echo "[wiki-memory] Memory capture ENABLED"
echo "  Scope:  $SCOPE"
echo "  Hooks:  SessionStart, PreCompact, SessionEnd"
echo "  Vault:  $VAULT_PATH"
echo "  Config: $SIDECAR_FILE"
echo "  Backup: $BACKUP_PATH"
echo ""
echo "  Disable:  /wiki-memory disable"
echo "  Status:   /wiki-memory status"
echo "  Flush:    /wiki-memory flush"
echo ""
echo "  PRIVACY: Captured transcripts contain your full conversation history."
echo "  Add raw/sessions/ to your vault's .gitignore before committing."
echo "  Review transcripts before running /wiki-ingest — scrub sensitive data."
