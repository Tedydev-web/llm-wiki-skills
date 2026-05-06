#!/usr/bin/env bash
# Test shim for wiki-ingest Step 0: state check (incremental ingest)
# RULE_SOURCE: skills/wiki-ingest/references/state-json-spec.md:10-56
# RULE_HASH: 0beee63d5cef54d5795851070d6c76f36cac8f5c02e97c8a4232876fb257d9d5
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-ingest/shim/ingest-basic.sh

# Validates state.json skip logic: file unchanged (sha256 matches) → SKIP.
# Input: VAULT_DIR SOURCE_FILE
# Outputs: "SKIP <file>" if hash matches, "INGEST <file>" if changed/new

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
SOURCE_FILE="${2:-}"

if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

STATE="$VAULT_DIR/wiki/.state.json"

# Load state (empty if missing/corrupt)
if [ ! -f "$STATE" ] || ! jq empty "$STATE" 2>/dev/null; then
  echo "INFO: .state.json absent or corrupt — treating as empty"
  if [ -n "$SOURCE_FILE" ]; then
    echo "INGEST $SOURCE_FILE (no prior state)"
  fi
  exit 0
fi

# If specific file given, check its hash
if [ -n "$SOURCE_FILE" ]; then
  abs_src="$VAULT_DIR/$SOURCE_FILE"
  if [ ! -f "$abs_src" ]; then
    echo "ERROR: source file not found: $abs_src" >&2
    exit 1
  fi

  # Compute current sha256
  if command -v sha256sum >/dev/null 2>&1; then
    current_hash="$(sha256sum "$abs_src" | awk '{print $1}')"
  else
    current_hash="$(shasum -a 256 "$abs_src" | awk '{print $1}')"
  fi

  stored_hash="$(jq -r --arg f "$SOURCE_FILE" '.files[$f].sha256 // empty' "$STATE" 2>/dev/null || true)"
  stored_at="$(jq -r --arg f "$SOURCE_FILE" '.files[$f].ingested_at // empty' "$STATE" 2>/dev/null || true)"

  if [ -n "$stored_hash" ] && [ "$stored_hash" = "$current_hash" ]; then
    echo "SKIP $SOURCE_FILE — unchanged since $stored_at"
  else
    echo "INGEST $SOURCE_FILE (hash: $current_hash)"
  fi
else
  # List all files and their skip/ingest status
  jq -r '.files | to_entries[] | "\(.key) \(.value.sha256) \(.value.ingested_at)"' "$STATE" 2>/dev/null \
    | while read -r path stored_hash stored_at; do
        abs="$VAULT_DIR/$path"
        if [ ! -f "$abs" ]; then
          echo "ORPHAN $path (file no longer exists)"
          continue
        fi
        if command -v sha256sum >/dev/null 2>&1; then
          current="$(sha256sum "$abs" | awk '{print $1}')"
        else
          current="$(shasum -a 256 "$abs" | awk '{print $1}')"
        fi
        if [ "$stored_hash" = "$current" ]; then
          echo "SKIP $path — unchanged since $stored_at"
        else
          echo "INGEST $path (changed)"
        fi
      done
fi
