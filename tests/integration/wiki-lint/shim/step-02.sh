#!/usr/bin/env bash
# Test shim for wiki-lint step 2 (orphan pages)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:21-29
# RULE_HASH: 204b948f55ec9fcc9197de4c6276642f46a29e310be10529b152bac420ef123c
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-02.sh

# Finds wiki pages with no inbound wikilinks from any other page.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "ORPHAN: <file>" or empty if clean

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
ORPHANS=0

for dir in sources entities concepts synthesis; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue
    # Get page name (filename without extension)
    name="$(basename "$page" .md)"
    # Search all other wiki pages for [[Name]] reference (case-insensitive slug match)
    # Convert slug back to title for search: replace - with space, title case
    title="$(echo "$name" | sed 's/-/ /g')"
    if grep -rqlE "\[\[$name\]\]|\[\[$title\]\]" "$WIKI_DIR" 2>/dev/null | grep -v "^$page$" >/dev/null 2>&1; then
      : # has inbound links
    elif grep -rqE "\[\[.*$name.*\]\]|\[\[.*$title.*\]\]" "$WIKI_DIR" --include="*.md" 2>/dev/null; then
      : # has inbound links (partial match)
    else
      echo "ORPHAN: $page"
      ORPHANS=$((ORPHANS + 1))
    fi
  done
done

if [ "$ORPHANS" -eq 0 ]; then
  echo "OK: step-02 orphan pages: none found"
fi
