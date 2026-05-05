#!/usr/bin/env bash
# Test shim for wiki-lint step 17 (.memory.log cross-reference audit)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:272-332
# RULE_HASH: 1b2c7a0afe76cb5c2f1608f5e72d71b771d1728e33e7dae81e89ba2bdf7e4c70
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-17.sh
#
# STATUS: P03 PLACEHOLDER — prose for step 17 exists in SKILL.md (added by P03).
# This shim implements the mechanical checks; golden test will SKIP until P03 merges.
# Remove SKIP guard in tests/integration/wiki-lint/test-step-17-memory-log-audit.sh after P03 lands.

# Audits wiki/.memory.log for orphaned log entries and orphaned session files.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: WARNING lines or OK/SKIP

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

MEMORY_LOG="$VAULT_DIR/wiki/.memory.log"
SESSIONS_DIR="$VAULT_DIR/raw/sessions"

# Step 17 only runs when .memory.log exists
if [ ! -f "$MEMORY_LOG" ]; then
  echo "INFO step-17: wiki/.memory.log absent — wiki-memory not enabled for this vault; step 17 skipped"
  exit 0
fi

if [ ! -d "$SESSIONS_DIR" ]; then
  echo "INFO step-17: raw/sessions/ absent — no session captures yet; step 17 skipped"
  exit 0
fi

FOUND=0
LOG_REGEX='^[0-9T:Z.-]+ (session-end|pre-compact) [^ ]+ -> .+\.md$'

# --- 17a: Orphaned log entries (log references missing session file) ---
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if ! echo "$line" | grep -qE "$LOG_REGEX"; then
    echo "WARNING step-17: unparseable log line: \"$line\""
    FOUND=$((FOUND + 1))
    continue
  fi
  filename="$(echo "$line" | sed 's/.* -> //')"
  basename_only="$(basename "$filename")"
  if [ ! -f "$SESSIONS_DIR/$basename_only" ]; then
    session_id="$(echo "$line" | awk '{print $3}')"
    verb="$(echo "$line" | awk '{print $2}')"
    echo "WARNING step-17: orphaned log entry — session=$session_id verb=$verb expected-file=raw/sessions/$basename_only (was it deleted manually?)"
    FOUND=$((FOUND + 1))
  fi
done < "$MEMORY_LOG"

# --- 17b: Orphaned session files (session file has no log entry) ---
for session_file in "$SESSIONS_DIR"/*.md; do
  [ -f "$session_file" ] || continue
  fname="$(basename "$session_file")"
  if ! grep -qF "-> $fname" "$MEMORY_LOG" 2>/dev/null; then
    echo "WARNING step-17: orphaned session file — raw/sessions/$fname has no log entry (may be from external import or manual copy)"
    FOUND=$((FOUND + 1))
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-17 .memory.log cross-reference: no orphaned entries or session files"
fi
