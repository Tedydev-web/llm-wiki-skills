#!/usr/bin/env bash
# Test shim for wiki-lint step 15 (state.json drift detection)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:213-271
# RULE_HASH: 6b7108eff918f02fcbea79e2dbe6f8506df9eba71210834ea116ecfd39314739
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-15.sh

# Validates wiki/.state.json for consistency between recorded state and actual files on disk.
# Sub-checks: 15c version, 15a orphan entries, 15b dangling output refs.
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: ERROR/WARNING/INFO lines or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

STATE="$VAULT_DIR/wiki/.state.json"
FOUND=0

# --- 15c: Version check (run first) ---
if [ ! -f "$STATE" ]; then
  echo "INFO step-15c: wiki/.state.json absent — no incremental state yet; will be created on first /wiki-ingest run"
  exit 0
fi

# Validate JSON
if ! jq empty "$STATE" 2>/dev/null; then
  echo "ERROR step-15c: wiki/.state.json is not valid JSON — delete and re-run /wiki-ingest to regenerate"
  exit 1
fi

# Check version field
version="$(jq -r '.version // empty' "$STATE" 2>/dev/null || true)"
if [ -z "$version" ]; then
  echo "WARNING step-15c: wiki/.state.json has no version field — steps 15a-15b skipped"
  exit 0
elif [ "$version" != "1" ]; then
  echo "WARNING step-15c: wiki/.state.json version=$version (unknown) — steps 15a-15b skipped to avoid false positives"
  exit 0
fi

echo "OK step-15c: wiki/.state.json version=1"

# --- 15a: Orphan entries (source files no longer on disk) ---
while IFS= read -r path; do
  abs="$VAULT_DIR/$path"
  if [ ! -f "$abs" ]; then
    echo "WARNING step-15a: .state.json orphan entry '$path' (file deleted; re-run /wiki-ingest to clean up)"
    FOUND=$((FOUND + 1))
  fi
done < <(jq -r '.files | keys[]' "$STATE" 2>/dev/null || true)

# --- 15b: Dangling output references ---
while IFS= read -r out; do
  abs="$VAULT_DIR/$out"
  if [ ! -f "$abs" ]; then
    src="$(jq -r --arg out "$out" '.files | to_entries[] | select(.value.ingested_into | arrays | contains([$out])) | .key' "$STATE" 2>/dev/null | head -1 || true)"
    echo "INFO step-15b: .state.json dangling output '$out' (source: '$src') — output deleted; re-ingest if needed"
    FOUND=$((FOUND + 1))
  fi
done < <(jq -r '.files | to_entries[] | .value.ingested_into // [] | .[]' "$STATE" 2>/dev/null || true)

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-15 state.json drift: no orphan entries or dangling outputs"
fi
