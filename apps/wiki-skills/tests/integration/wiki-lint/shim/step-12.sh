#!/usr/bin/env bash
# Test shim for wiki-lint step 12 (sources-array completeness F3)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:111-122
# RULE_HASH: b65339300a85743516830e6ab0d9dfee1fcc225abf1bc4e1fb164c969dada3e1
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-12.sh

# For each entity/concept page, finds source summaries that link to it but
# are not listed in the page's sources: YAML array (F3 incident pattern).
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: "MISSING_SOURCE_REF: entity.md missing source: source.md" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0

for dir in entities concepts; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue
    slug="$(basename "$page" .md)"

    # Get title for wikilink matching
    title="$(grep '^# ' "$page" | head -1 | sed 's/^# //')"
    [ -z "$title" ] && title="$(echo "$slug" | sed 's/-/ /g')"

    # Extract sources: array from frontmatter
    fm_sources="$(awk '/^---/{c++; if(c==2)exit} c==1' "$page" \
      | grep '^sources:' | sed 's/^sources: *\[//;s/\]//' \
      | tr ',' '\n' | sed 's/[" ]//g' | grep -v '^$' || true)"

    # Find source files that mention this entity/concept via wikilink
    for src in "$WIKI_DIR/sources"/*.md; do
      [ -f "$src" ] || continue
      src_name="$(basename "$src")"
      if grep -qE "\[\[$title\]\]|\[\[$slug\]\]" "$src" 2>/dev/null; then
        # Check if src_name is in sources: array
        if ! echo "$fm_sources" | grep -qF "$src_name"; then
          echo "MISSING_SOURCE_REF: $page missing source: $src_name (which links to [[$title]])"
          FOUND=$((FOUND + 1))
        fi
      fi
    done
  done
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-12 sources-array completeness: no missing source refs"
fi
