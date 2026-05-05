#!/usr/bin/env bash
# Test shim for wiki-lint step 13 (regenerate wiki/cache.md N1)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:123-136
# RULE_HASH: 14b01380779f0c680377acb05faa1632384c78fc75e8bb5de990539566d2798b
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-13.sh

# Checks whether wiki/cache.md exists and appears current (not severely outdated).
# Heuristic: newest date in wiki/log.md should be within 1 year of cache.md updated: date.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: "STALE_CACHE: cache.md updated DATE, log has newer DATE" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
CACHE="$WIKI_DIR/cache.md"
LOG="$WIKI_DIR/log.md"

if [ ! -f "$CACHE" ]; then
  echo "MISSING_CACHE: wiki/cache.md does not exist — run /wiki-lint to regenerate"
  exit 0
fi

# Extract cache updated year
cache_year="$(grep '^updated:' "$CACHE" 2>/dev/null | head -1 | grep -oE '[0-9]{4}' | head -1 || echo 0)"

# Extract newest log entry year
log_year=0
if [ -f "$LOG" ]; then
  newest="$(grep -oE '^## \[[0-9]{4}-[0-9]{2}-[0-9]{2}\]' "$LOG" 2>/dev/null | grep -oE '[0-9]{4}' | sort -n | tail -1 || echo 0)"
  log_year="${newest:-0}"
fi

if [ "$cache_year" -eq 0 ]; then
  echo "INFO: step-13 cache.md has no updated: date — cannot assess freshness"
elif [ "$log_year" -gt 0 ] && [ "$log_year" -gt "$cache_year" ]; then
  gap=$(( log_year - cache_year ))
  echo "STALE_CACHE: wiki/cache.md updated $cache_year but log has entries from $log_year (gap: ${gap}y) — regenerate via /wiki-lint"
else
  echo "OK: step-13 cache.md appears current (updated: $cache_year, log newest: $log_year)"
fi
