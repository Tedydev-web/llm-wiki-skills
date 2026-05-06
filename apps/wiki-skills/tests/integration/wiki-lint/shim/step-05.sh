#!/usr/bin/env bash
# Test shim for wiki-lint step 5 (missing pages for wikilinks)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:43-46
# RULE_HASH: 1879ea262e98a0405cd8bbc3ed14cc7a4119efba89dad8af239de85b7fc824e3
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-05.sh

# Finds [[wikilinks]] that point to non-existent pages (topics not yet given their own page).
# Unlike step-01 which checks wiki/ pages, step-05 assesses whether missing pages warrant creation.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "MISSING_PAGE: [[Target]] (referenced in file)" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
MISSING=0

# Collect all existing page slugs
existing_slugs=""
for page in "$WIKI_DIR"/*/*.md; do
  [ -f "$page" ] || continue
  slug="$(basename "$page" .md)"
  existing_slugs="$existing_slugs $slug"
done

# Find all wikilinks and check if target page exists
grep -roh '\[\[[^]|]*\]\]' "$WIKI_DIR" --include="*.md" 2>/dev/null \
  | sed 's/\[\[//;s/\]\]//' \
  | sort -u \
  | while read -r target; do
    [ -z "$target" ] && continue
    slug="$(echo "$target" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
    found=0
    for page in "$WIKI_DIR"/*/"${slug}.md" "$WIKI_DIR"/*/"${target}.md"; do
      [ -f "$page" ] && found=1 && break
    done
    if [ "$found" -eq 0 ]; then
      echo "MISSING_PAGE: [[$target]]"
      MISSING=$((MISSING + 1))
    fi
  done

# Count output lines for summary
lines="$(grep -roh '\[\[[^]|]*\]\]' "$WIKI_DIR" --include="*.md" 2>/dev/null | wc -l || echo 0)"
if [ "$MISSING" -eq 0 ]; then
  echo "OK: step-05 missing pages: all wikilinks have target pages"
fi
