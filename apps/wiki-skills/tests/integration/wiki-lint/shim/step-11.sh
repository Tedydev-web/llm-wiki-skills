#!/usr/bin/env bash
# Test shim for wiki-lint step 11 (missing inline citations L1c)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:90-110
# RULE_HASH: 1da0471668a4694d41902755325dec37f869d3cac54bf8e6d652952f867aab81
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-11.sh

# Finds entity/concept/synthesis pages with sentences lacking (source: ...) or [needs verification].
# Heuristic: period-terminated body sentences without citation marker.
# Cap: top-10 pages with 3+ suspect claims.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: "SUSPECT_CITATION: file: N suspect claims" lines or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0
CAP=10
MIN_CLAIMS=3

tmpfile=$(mktemp)

for dir in entities concepts synthesis; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue

    # Count sentences ending in period that lack citation or verification tag
    # Skip: headers, code blocks, list items that are wikilinks, blank lines
    suspect=0
    in_code=0
    while IFS= read -r line; do
      # Track code block state
      case "$line" in
        '```'*) in_code=$(( 1 - in_code )); continue ;;
      esac
      [ "$in_code" -eq 1 ] && continue

      # Skip headers, blank lines, frontmatter markers, list-only wikilinks
      case "$line" in
        '#'*|'---'|''|'- [['*) continue ;;
      esac

      # Period-terminated sentence body
      if echo "$line" | grep -qE '\.$'; then
        if ! echo "$line" | grep -qE '\(source:|sources:|needs verification\]'; then
          suspect=$((suspect + 1))
        fi
      fi
    done < "$page"

    [ "$suspect" -ge "$MIN_CLAIMS" ] && echo "$suspect $page" >> "$tmpfile"
  done
done

# Sort by suspect count desc, cap at TOP 10
sort -rn "$tmpfile" | head -"$CAP" | while read -r count path; do
  echo "SUSPECT_CITATION: $path: $count suspect claims"
  FOUND=$((FOUND + 1))
done
rm -f "$tmpfile"

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-11 inline citations: no pages with 3+ suspect claims"
else
  echo "INFO: step-11 classified as info severity — review, not auto-fix"
fi
