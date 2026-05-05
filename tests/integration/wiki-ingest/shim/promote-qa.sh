#!/usr/bin/env bash
# Test shim for wiki-ingest --promote-qa workflow
# RULE_SOURCE: skills/wiki-ingest/references/promote-qa-workflow.md:10-77
# RULE_HASH: fe6107001c6ab25837ed975b0dc86d63bb978e9653d3280b43abf5c890f211da
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-ingest/shim/promote-qa.sh

# Validates --promote-qa mechanics: reads qa/<slug>.md, strips QA fields,
# produces concept frontmatter, writes wiki/concepts/<slug>.md.
# Input: VAULT_DIR SLUG
# Output: PROMOTED/ERROR lines

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
SLUG="${2:-}"

if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi
if [ -z "$SLUG" ]; then echo "ERROR: SLUG not set" >&2; exit 1; fi

QA_FILE="$VAULT_DIR/wiki/qa/$SLUG.md"
CONCEPT_FILE="$VAULT_DIR/wiki/concepts/$SLUG.md"

# Step 1: Check QA file exists
if [ ! -f "$QA_FILE" ]; then
  echo "ERROR: wiki/qa/$SLUG.md not found"
  exit 1
fi

# Step 2-4: Validate required QA-specific fields exist before promotion
fm="$(awk '/^---/{c++; if(c==2)exit} c==1' "$QA_FILE" 2>/dev/null)"

for field in question asked_at confidence answer_summary; do
  if ! echo "$fm" | grep -q "^${field}:"; then
    echo "ERROR: QA file missing field '$field' — cannot promote"
    exit 1
  fi
done

# Step 5: Check concept page collision
if [ -f "$CONCEPT_FILE" ]; then
  echo "WARNING: wiki/concepts/$SLUG.md already exists — would overwrite (y/n prompt needed)"
fi

# Simulate promotion output (structural validation — LLM executes actual write)
today="$(date +%Y-%m-%d 2>/dev/null || echo "2026-01-01")"
asked_at="$(echo "$fm" | grep '^asked_at:' | head -1 | awk '{print $2}' | cut -c1-10)"
created="${asked_at:-$today}"

echo "PROMOTED: wiki/concepts/$SLUG.md"
echo "  tags: [concept, promoted-from-qa]"
echo "  created: $created"
echo "  updated: $today"
echo "  source qa: wiki/qa/$SLUG.md (kept, not deleted)"

# Verify ## Answer section exists in QA body
if grep -q '^## Answer' "$QA_FILE"; then
  echo "  body: ## Answer section found (will become concept body)"
else
  echo "WARNING: ## Answer section missing from qa/$SLUG.md"
fi
