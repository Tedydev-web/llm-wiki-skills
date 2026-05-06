#!/usr/bin/env bash
# Test shim for wiki-lint step 16 (index schema field — part of step 14c)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:198-212
# RULE_HASH: 9b20a4f3f550c4e35965569c44fef1e39d75d53deb79c09fd0110b1b3dde58fe
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-16.sh

# Dedicated shim for _schema field validation in wiki/index.md (step 14c promoted to step 16).
# Checks: _schema: 2 present → pass; absent → info; wrong value → error.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: ERROR/INFO/OK line

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

INDEX="$VAULT_DIR/wiki/index.md"

if [ ! -f "$INDEX" ]; then
  echo "ERROR step-16: wiki/index.md not found"
  exit 1
fi

schema_val="$(awk '/^---/{c++; if(c==2)exit} c==1' "$INDEX" \
  | grep '^_schema:' | head -1 | awk '{print $2}' || true)"

if [ -z "$schema_val" ]; then
  echo "INFO step-16: wiki/index.md has no _schema field — v1->v2 migration pending; first /wiki-ingest run will set _schema: 2"
elif [ "$schema_val" = "2" ]; then
  echo "OK step-16: wiki/index.md _schema: 2 (fully migrated v2 vault)"
else
  echo "ERROR step-16: wiki/index.md _schema=$schema_val — unexpected value; expected 2"
  exit 1
fi
