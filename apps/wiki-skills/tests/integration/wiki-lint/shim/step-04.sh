#!/usr/bin/env bash
# Test shim for wiki-lint step 4 (stale claims)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:37-42
# RULE_HASH: d0e0f31ca1a17b29285025c079a82858124ac20e10f34cd511b2d36f33e72554
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-04.sh

# Detects concept/entity pages updated before a cutoff year while newer sources exist.
# Heuristic: page updated: field is >2 years behind newest source in vault.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "STALE: file (updated: DATE, but newer sources exist)" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
STALE=0

# Find newest source date in vault
newest_year=2000
for src in "$WIKI_DIR/sources"/*.md; do
  [ -f "$src" ] || continue
  yr="$(grep '^updated:' "$src" 2>/dev/null | head -1 | grep -oE '[0-9]{4}' | head -1 || true)"
  [ -n "$yr" ] && [ "$yr" -gt "$newest_year" ] && newest_year="$yr"
done

# Check concept/entity pages for stale updated: dates
for dir in entities concepts; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue
    updated="$(grep '^updated:' "$page" 2>/dev/null | head -1 | grep -oE '[0-9]{4}' | head -1 || true)"
    [ -z "$updated" ] && continue
    age=$(( newest_year - updated ))
    if [ "$age" -ge 2 ]; then
      echo "STALE: $page (updated: $updated, newest source: $newest_year, gap: ${age}y)"
      STALE=$((STALE + 1))
    fi
  done
done

if [ "$STALE" -eq 0 ]; then
  echo "OK: step-04 stale claims: none found"
fi
