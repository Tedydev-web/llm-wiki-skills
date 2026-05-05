#!/usr/bin/env bash
# Test shim for wiki-lint step 6 (missing cross-references)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:47-53
# RULE_HASH: f7484a07040c2ae00817e8476c3944e3a4ff214722246d7be02a79deb81d212f
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-06.sh

# Finds pages that mention entity/concept names without linking them via [[wikilink]].
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "MISSING_XREF: file mentions 'Name' without [[wikilink]]" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0

# For each entity/concept, check if any page mentions name without wikilink
for dir in entities concepts; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue
    name="$(basename "$page" .md)"
    title="$(echo "$name" | sed 's/-/ /g')"

    # Search all pages for plain-text mention without wikilink brackets
    # i.e., "Sample Entity" but not "[[Sample Entity]]"
    while IFS=: read -r src_file lineno text; do
      # Skip the page itself
      [ "$src_file" = "$page" ] && continue
      echo "MISSING_XREF: $src_file:$lineno mentions '$title' without [[wikilink]]"
      FOUND=$((FOUND + 1))
    done < <(grep -rn "$title" "$WIKI_DIR" --include="*.md" 2>/dev/null \
             | grep -v "\[\[$title\]\]\|\[\[$name\]\]" || true)
  done
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-06 missing cross-references: none found"
fi
