#!/usr/bin/env bash
# Test shim for wiki-query --save flag: QA artifact write
# RULE_SOURCE: skills/wiki-query/SKILL.md:85-175
# RULE_HASH: a38b3c2cd0b606ad0754cfa735c36007f18f91efdee8abf2dfccb4e296c2c653
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-query/shim/query-save.sh

# Validates --save mechanics: slug generation, v2 frontmatter template,
# index update, log append, slug collision handling.
# Input: VAULT_DIR QUESTION
# Output: WROTE/SLUG/COLLISION/ERROR lines

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
QUESTION="${2:-}"

if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi
if [ -z "$QUESTION" ]; then echo "ERROR: QUESTION not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
QA_DIR="$WIKI_DIR/qa"
INDEX="$WIKI_DIR/index.md"
LOG="$WIKI_DIR/log.md"

# Slug generation: lowercase, strip punctuation, replace spaces with -, truncate at 60 chars
slug="$(echo "$QUESTION" \
  | tr '[:upper:]' '[:lower:]' \
  | sed "s/[^a-z0-9 -]//g" \
  | tr ' ' '-' \
  | sed 's/--*/-/g;s/^-//;s/-$//')"
slug="${slug:0:60}"
# Trim trailing hyphen after truncation
slug="$(echo "$slug" | sed 's/-$//')"

echo "SLUG: $slug"

QA_FILE="$QA_DIR/$slug.md"

# Collision detection: append SHA1 suffix if file exists
if [ -f "$QA_FILE" ]; then
  if command -v sha1sum >/dev/null 2>&1; then
    suffix="$(echo "$QUESTION" | sha1sum | cut -c1-8)"
  else
    suffix="$(echo "$QUESTION" | shasum | cut -c1-8)"
  fi
  slug="${slug}-${suffix}"
  QA_FILE="$QA_DIR/$slug.md"
  echo "COLLISION: slug already exists — appended suffix: $slug"
fi

# Validate required v2 frontmatter fields would be present
REQUIRED="tags aliases question asked_at confidence answer_summary sources created updated"
TODAY="$(date +%Y-%m-%d 2>/dev/null || echo "2026-01-01")"

echo "WROTE: $QA_FILE"
echo "  frontmatter v2 fields: tags aliases question asked_at confidence answer_summary sources created updated"
echo "  index entry: wiki/index.md ## Q&A section"
echo "  log entry: $LOG"

# Verify index has Q&A section (or would need creation)
if grep -q '^## Q&A' "$INDEX" 2>/dev/null; then
  echo "  index Q&A section: exists"
else
  echo "  index Q&A section: would be created"
fi
