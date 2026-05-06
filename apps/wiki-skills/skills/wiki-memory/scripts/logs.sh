#!/usr/bin/env bash
# logs.sh — Tail or follow the wiki-memory capture log
# Usage: logs.sh [--follow|-f] [--lines|-n <N>]
# Default: tail last 50 lines of <vault>/wiki/.memory.log
# --follow / -f : stream new entries as they are appended (tail -f)
# --lines  / -n : number of lines to show (default 50)
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found." >&2; exit 1; }

source "$SCRIPT_DIR/lib-jq-merge.sh"
# shellcheck source=lib-vault-discovery.sh
source "$SCRIPT_DIR/lib-vault-discovery.sh"

# ── Argument parsing ───────────────────────────────────────────────────────────
FOLLOW=0
LINES=50

while [[ $# -gt 0 ]]; do
  case "$1" in
    --follow|-f)
      FOLLOW=1
      shift
      ;;
    --lines|-n)
      LINES="${2:?--lines requires a numeric argument}"
      if ! [[ "$LINES" =~ ^[0-9]+$ ]]; then
        echo "[wiki-memory] ERROR: --lines requires a positive integer, got: '$LINES'" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--follow|-f] [--lines|-n <N>]"
      echo ""
      echo "  --follow, -f      Stream new log entries as they arrive (Ctrl-C to stop)"
      echo "  --lines,  -n <N>  Show last N lines (default: 50)"
      exit 0
      ;;
    *)
      echo "[wiki-memory] ERROR: Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ── Vault discovery via shared lib (5-step precedence) ────────────────────────
VAULT_PATH=""
VAULT_PATH="$(discover_vault 2>/dev/null || true)"
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"
VAULT_PATH="${VAULT_PATH%/}"

if [[ -z "$VAULT_PATH" ]]; then
  echo "[wiki-memory] ERROR: wiki-memory is not enabled. Run '/wiki-memory enable' first." >&2
  exit 1
fi

# ── Locate the memory log ──────────────────────────────────────────────────────
MEMORY_LOG="$VAULT_PATH/wiki/.memory.log"

if [[ ! -f "$MEMORY_LOG" ]]; then
  echo "[wiki-memory] No log file found at: $MEMORY_LOG"
  echo "  Log is created on first successful capture."
  echo "  Run '/wiki-memory flush' or start a new Claude Code session to generate one."
  exit 0
fi

# ── Tail or follow ─────────────────────────────────────────────────────────────
if [[ "$FOLLOW" -eq 1 ]]; then
  echo "[wiki-memory] Following $MEMORY_LOG  (Ctrl-C to stop)"
  echo "─────────────────────────────────────────"
  tail -f "$MEMORY_LOG"
else
  echo "[wiki-memory] Last $LINES entries from $MEMORY_LOG"
  echo "─────────────────────────────────────────"
  tail -n "$LINES" "$MEMORY_LOG"
  echo "─────────────────────────────────────────"
  echo "  Use --follow / -f to stream live entries."
fi
