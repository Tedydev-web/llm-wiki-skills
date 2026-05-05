#!/usr/bin/env bash
# Test shim for wiki-lint step 9 (aliases consistency L1a)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:68-79
# RULE_HASH: 226039a2fc66c9fd7f052eafb97204e9035c30182e565df6bb485ca66bb4756b
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-09.sh

# Checks that every entity/concept page has aliases: field in frontmatter.
# Also verifies aliases[0] matches the H1 heading (Title Case, exact match).
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "MISSING_ALIASES: file" or "ALIAS_MISMATCH: file" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0

for dir in entities concepts; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue

    # Check aliases: field present in frontmatter
    if ! awk '/^---/{c++; if(c==2)exit} c==1' "$page" | grep -q '^aliases:'; then
      echo "MISSING_ALIASES: $page"
      FOUND=$((FOUND + 1))
      continue
    fi

    # Extract first alias value (handles "aliases: [Value]" and "aliases:\n  - Value")
    first_alias="$(awk '/^---/{c++; if(c==2)exit} c==1 && /^aliases:/' "$page" \
      | sed 's/^aliases: *\[//;s/\].*//;s/^aliases: *//' \
      | head -1 | sed 's/^[- ]*//' | sed "s/[\"']//g")"

    # Extract H1
    h1="$(grep '^# ' "$page" | head -1 | sed 's/^# //')"

    if [ -n "$first_alias" ] && [ -n "$h1" ] && [ "$first_alias" != "$h1" ]; then
      echo "ALIAS_MISMATCH: $page (aliases[0]='$first_alias' != H1='$h1')"
      FOUND=$((FOUND + 1))
    fi
  done
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-09 aliases consistency: all entity/concept pages have correct aliases"
fi
