#!/usr/bin/env bash
# Test shim for wiki-lint step 7 (index consistency)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:54-60
# RULE_HASH: 5759a75f65bdec3d1de4a36ae239c6500e12dd3b7c438064cb2e99fff530ee67
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-07.sh

# Verifies wiki/index.md has an entry for every page in sources/entities/concepts/synthesis.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "UNLISTED: file not in index" or "DANGLING: index entry has no file" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
INDEX="$WIKI_DIR/index.md"
FOUND=0

if [ ! -f "$INDEX" ]; then
  echo "ERROR: wiki/index.md not found" >&2
  exit 1
fi

# Check every wiki page appears in index
for dir in sources entities concepts synthesis; do
  [ -d "$WIKI_DIR/$dir" ] || continue
  for page in "$WIKI_DIR/$dir"/*.md; do
    [ -f "$page" ] || continue
    slug="$(basename "$page" .md)"
    if ! grep -qE "\[\[$dir/$slug\]\]|\[\[$slug\]\]" "$INDEX" 2>/dev/null; then
      echo "UNLISTED: $page not referenced in wiki/index.md"
      FOUND=$((FOUND + 1))
    fi
  done
done

# Check index entries point to existing files
grep -oE '\[\[[^]]+\]\]' "$INDEX" 2>/dev/null | sed 's/\[\[//;s/\]\]//;s/ —.*//' | while read -r ref; do
  [ -z "$ref" ] && continue
  slug="$(echo "$ref" | sed 's|.*/||')"
  dir="$(echo "$ref" | grep -oE '^[^/]+/' | tr -d '/')"
  if [ -n "$dir" ]; then
    target="$WIKI_DIR/$dir/$slug.md"
  else
    target=""
    for d in sources entities concepts synthesis qa; do
      [ -f "$WIKI_DIR/$d/$slug.md" ] && target="$WIKI_DIR/$d/$slug.md" && break
    done
  fi
  if [ -n "$target" ] && [ ! -f "$target" ]; then
    echo "DANGLING: index entry [[$ref]] has no corresponding file"
    FOUND=$((FOUND + 1))
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-07 index consistency: all pages listed, no dangling entries"
fi
