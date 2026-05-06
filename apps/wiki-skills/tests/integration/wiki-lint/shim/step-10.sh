#!/usr/bin/env bash
# Test shim for wiki-lint step 10 (verification tags L1b)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:80-89
# RULE_HASH: 6b6d42bea0a181853bad8947158265a98affbbad17f447d0eabc27430dedf583
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-10.sh

# Greps all wiki pages for [needs verification] flags.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: lines of "NEEDS_VERIFY: file:line: <context>" or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
FOUND=0

while IFS=: read -r file lineno text; do
  echo "NEEDS_VERIFY: $file:$lineno: $text"
  FOUND=$((FOUND + 1))
done < <(grep -rn '\[needs verification\]' "$WIKI_DIR" --include="*.md" 2>/dev/null || true)

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-10 verification tags: no [needs verification] flags found"
else
  echo "WARNING: step-10 found $FOUND [needs verification] flag(s) — classify as warning, not error"
fi
