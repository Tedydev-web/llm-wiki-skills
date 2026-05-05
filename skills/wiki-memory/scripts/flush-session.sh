#!/usr/bin/env bash
# flush-session.sh — Force-write the current in-progress session transcript to vault
# Usage: flush-session.sh
#
# Discovers the current Claude Code transcript via CLAUDE_TRANSCRIPT_PATH env
# or falls back to the most-recently-modified .jsonl in ~/.claude/projects/*/
# Synthesises a manual-flush event payload and pipes it to hook-session-end.sh.
#
# SNAPSHOT SEMANTICS: Reads the transcript at call-time. If Claude is mid-response
# the final turn will appear truncated. Re-run flush (or wait for SessionEnd) to
# capture the complete exchange. Output filenames carry a 'flush-' prefix.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found." >&2; exit 1; }

source "$SCRIPT_DIR/lib-jq-merge.sh"

# ── Dependency check ───────────────────────────────────────────────────────────
require_jq

# ── hook-session-end.sh must exist (P2 deliverable) ───────────────────────────
HOOK_SESSION_END="$SCRIPT_DIR/hook-session-end.sh"
if [[ ! -f "$HOOK_SESSION_END" ]]; then
  echo "[wiki-memory] ERROR: hook-session-end.sh not found at: $HOOK_SESSION_END" >&2
  echo "  Phase-02 hook scripts must be installed before using flush." >&2
  exit 1
fi

# ── Vault sidecar check ────────────────────────────────────────────────────────
# flush-session.sh does not need to know the vault path directly — hook-session-end.sh
# reads its own sidecar. But we surface an early warning if neither sidecar exists.
GLOBAL_SIDECAR="$HOME/.config/wiki-memory/vault-path"
PROJECT_SIDECAR="$PWD/.claude/wiki-memory.conf"

if [[ ! -f "$GLOBAL_SIDECAR" && ! -f "$PROJECT_SIDECAR" ]]; then
  echo "[wiki-memory] ERROR: wiki-memory is not enabled. Run '/wiki-memory enable' first." >&2
  exit 1
fi

# ── Transcript discovery ───────────────────────────────────────────────────────
TRANSCRIPT_PATH=""

if [[ -n "${CLAUDE_TRANSCRIPT_PATH:-}" ]]; then
  TRANSCRIPT_PATH="$CLAUDE_TRANSCRIPT_PATH"
  echo "[wiki-memory] Using transcript from CLAUDE_TRANSCRIPT_PATH: $TRANSCRIPT_PATH"
else
  # Fallback: most recently modified .jsonl under ~/.claude/projects/
  PROJECTS_DIR="$HOME/.claude/projects"
  if [[ -d "$PROJECTS_DIR" ]]; then
    # find + sort by modification time — macOS (BSD find) and GNU find compatible
    if TRANSCRIPT_PATH="$(find "$PROJECTS_DIR" -maxdepth 3 -name "*.jsonl" -newer /dev/null 2>/dev/null \
        | xargs ls -t 2>/dev/null | head -1)"; then
      # xargs ls -t handles macOS bash 3.2 limitation (no find -printf)
      [[ -n "$TRANSCRIPT_PATH" ]] || TRANSCRIPT_PATH=""
    fi
  fi

  if [[ -z "$TRANSCRIPT_PATH" ]]; then
    echo "[wiki-memory] WARNING: No transcript file found automatically." >&2
    echo "  Set CLAUDE_TRANSCRIPT_PATH to the .jsonl path you want to flush." >&2
    echo "  Example: CLAUDE_TRANSCRIPT_PATH=~/.claude/projects/foo/session.jsonl /wiki-memory flush" >&2
    exit 1
  fi

  echo "[wiki-memory] Auto-discovered transcript: $TRANSCRIPT_PATH"
fi

# Verify transcript exists and is readable
if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "[wiki-memory] ERROR: Transcript file not found: $TRANSCRIPT_PATH" >&2
  exit 1
fi
if [[ ! -r "$TRANSCRIPT_PATH" ]]; then
  echo "[wiki-memory] ERROR: Transcript file is not readable: $TRANSCRIPT_PATH" >&2
  exit 1
fi

# ── Build synthetic event payload ──────────────────────────────────────────────
# hook-session-end.sh expects a JSON object on stdin matching the SessionEnd schema.
# We set source=manual so the hook can distinguish flush captures from organic ones.
FLUSH_SESSION_ID="manual-flush-$(date +%s)"

PAYLOAD="$(jq -n \
  --arg session_id "$FLUSH_SESSION_ID" \
  --arg transcript_path "$TRANSCRIPT_PATH" \
  --arg source "manual" \
  '{
    session_id: $session_id,
    transcript_path: $transcript_path,
    source: $source
  }')"

# ── Invoke hook-session-end.sh ─────────────────────────────────────────────────
echo "[wiki-memory] Flushing transcript snapshot..."
echo "  Session ID: $FLUSH_SESSION_ID"
echo "  Transcript: $TRANSCRIPT_PATH"
echo "  NOTE: Final turn may be partial if Claude is still responding."
echo "        Re-run flush or wait for SessionEnd to capture the complete exchange."
echo ""

# Pipe synthetic payload as stdin to the hook script
echo "$PAYLOAD" | bash "$HOOK_SESSION_END"

echo ""
echo "[wiki-memory] Flush complete. Capture written to vault raw/sessions/."
echo "  Review with: /wiki-memory logs"
