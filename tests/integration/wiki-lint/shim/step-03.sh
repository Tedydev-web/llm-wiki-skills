#!/usr/bin/env bash
# Test shim for wiki-lint step 3 (contradictions)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:30-36
# RULE_HASH: 603a3e0e3731e8dfcd77d874d728128bee22d07156e106e93b4a6ad3b2b703be
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-03.sh

# Detects explicit contradiction markers in wiki pages.
# Looks for "(sources: X disagrees with Y)" pattern per K1 ingest convention.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "CONTRADICTION: file:line: <snippet>" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0

# Step 3 is largely LLM-evaluated; the shim checks for explicit markers
while IFS=: read -r file lineno text; do
  echo "CONTRADICTION: $file:$lineno: $text"
  FOUND=$((FOUND + 1))
done < <(grep -rn 'disagrees with\|contradicts\|conflicts with' "$WIKI_DIR" --include="*.md" 2>/dev/null || true)

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-03 contradictions: no explicit markers found"
fi
