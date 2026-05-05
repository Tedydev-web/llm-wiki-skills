#!/usr/bin/env bash
# Test shim for wiki-lint step 8 (data gaps)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:61-67
# RULE_HASH: f899f30a2dae4c0750b327629c3818d52c62ad16426376a8359f1adbe39997dd
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-08.sh

# Identifies topics mentioned frequently across wiki pages but lacking dedicated pages.
# Heuristic: non-wikilinked noun phrases appearing 3+ times without a wiki page.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "GAP: '<topic>' mentioned N times but no page" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
THRESHOLD=3
FOUND=0

# Step 8 is primarily LLM-evaluated (semantic analysis).
# Shim checks for [[wikilinks]] pointing to non-existent pages with high frequency.
# This is a structural proxy for "mentioned but no page."

declare -A link_counts 2>/dev/null || true

# Count unresolved wikilinks (step-05 logic) by frequency
tmpfile=$(mktemp)
grep -roh '\[\[[^]|]*\]\]' "$WIKI_DIR" --include="*.md" 2>/dev/null \
  | sed 's/\[\[//;s/\]\]//' \
  | sort \
  | uniq -c \
  | sort -rn \
  > "$tmpfile" || true

while read -r count target; do
  [ -z "$target" ] && continue
  [ "$count" -lt "$THRESHOLD" ] && continue
  slug="$(echo "$target" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
  found=0
  for page in "$WIKI_DIR"/*/"${slug}.md" "$WIKI_DIR"/*/"${target}.md"; do
    [ -f "$page" ] && found=1 && break
  done
  if [ "$found" -eq 0 ]; then
    echo "GAP: '$target' mentioned $count times but no wiki page exists"
    FOUND=$((FOUND + 1))
  fi
done < "$tmpfile"
rm -f "$tmpfile"

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-08 data gaps: no high-frequency unlinked topics found"
fi
