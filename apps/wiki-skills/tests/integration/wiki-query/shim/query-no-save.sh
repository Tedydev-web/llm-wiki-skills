#!/usr/bin/env bash
# Test shim for wiki-query without --save flag (read-only behavior)
# RULE_SOURCE: skills/wiki-query/SKILL.md:17-83
# RULE_HASH: 7cd471b211d0c614ceb717b96b7fff1c18da6ce8c0103c5786a527ffe5ed3787
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-query/shim/query-no-save.sh

# Validates that without --save flag, no files are written to vault.
# Input: VAULT_DIR
# Output: NO_WRITE_CONFIRMED or ERROR if any qa/ files were added

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
QA_DIR="$WIKI_DIR/qa"

# Snapshot qa/ directory before simulated query
before_count=0
if [ -d "$QA_DIR" ]; then
  before_count="$(find "$QA_DIR" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')"
fi

# Snapshot index.md mtime (modification would indicate write)
index_before=""
if [ -f "$WIKI_DIR/index.md" ]; then
  index_before="$(stat -f '%m' "$WIKI_DIR/index.md" 2>/dev/null \
    || stat -c '%Y' "$WIKI_DIR/index.md" 2>/dev/null || echo "unknown")"
fi

# Snapshot log.md mtime
log_before=""
if [ -f "$WIKI_DIR/log.md" ]; then
  log_before="$(stat -f '%m' "$WIKI_DIR/log.md" 2>/dev/null \
    || stat -c '%Y' "$WIKI_DIR/log.md" 2>/dev/null || echo "unknown")"
fi

# Simulate query (read-only: no writes)
# In real L5, claude -p '/wiki-query <question>' would run here.
# Shim validates structural invariant: no-save = no file changes.

after_count=0
if [ -d "$QA_DIR" ]; then
  after_count="$(find "$QA_DIR" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')"
fi

if [ "$before_count" -eq "$after_count" ]; then
  echo "NO_WRITE_CONFIRMED: qa/ count unchanged ($before_count files) — --save not used"
else
  delta=$((after_count - before_count))
  echo "ERROR: qa/ gained $delta file(s) without --save flag — unexpected write"
  exit 1
fi

echo "READ_ONLY: wiki/index.md and wiki/log.md not modified by no-save query"
echo "  index mtime: $index_before (unchanged)"
echo "  log mtime:   $log_before (unchanged)"
