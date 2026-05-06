#!/usr/bin/env bash
# Test shim for wiki-lint step 1 (broken wikilinks)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:10-20
# RULE_HASH: 1655feaaf9b72aebe6279797de2372cce6ed0abc05037349a395b18720b5b170
# To regenerate after SKILL.md edit:
#   bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-01.sh

# Scans wiki/ for [[wikilink]] references that point to non-existent pages.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "BROKEN: file:line: [[Target]]" or empty if clean

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then
  echo "ERROR: VAULT_DIR not set" >&2
  exit 1
fi

WIKI_DIR="$VAULT_DIR/wiki"
if [ ! -d "$WIKI_DIR" ]; then
  echo "ERROR: wiki dir not found: $WIKI_DIR" >&2
  exit 1
fi

BROKEN=0

# Extract all wikilinks and verify targets exist
while IFS=: read -r src_file line_num link_raw; do
  # Strip [[ and ]] and any pipe alias
  target="$(echo "$link_raw" | grep -oh '\[\[[^]]*\]\]' | sed 's/\[\[//;s/\]\]//;s/|.*//')"
  [ -z "$target" ] && continue

  # Convert to filename: lowercase kebab (approximate lookup)
  slug="$(echo "$target" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

  # Check if page exists in any wiki subdir (by slug or title)
  found=0
  for f in "$WIKI_DIR"/*/"${slug}.md" "$WIKI_DIR"/*/"${target}.md"; do
    [ -f "$f" ] && found=1 && break
  done

  if [ "$found" -eq 0 ]; then
    echo "BROKEN: $src_file:$line_num: [[$target]]"
    BROKEN=$((BROKEN + 1))
  fi
done < <(grep -rn '\[\[[^]]*\]\]' "$WIKI_DIR" 2>/dev/null || true)

if [ "$BROKEN" -eq 0 ]; then
  echo "OK: step-01 broken wikilinks: none found"
fi
