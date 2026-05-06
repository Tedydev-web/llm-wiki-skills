#!/usr/bin/env bash
# Test shim for wiki-ingest Step N: state write (atomic + schema migration)
# RULE_SOURCE: skills/wiki-ingest/references/state-json-spec.md:57-126
# RULE_HASH: baa6d1c676ca1e967165adf8e9fabdfb7b74b14daae0ab3375929ae9817be942
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-ingest/shim/state-update.sh

# Validates atomic state write mechanics:
# - Writes to .state.json.tmp first, then renames (atomic)
# - Merges new entry without clobbering existing entries
# - Sets _schema: 2 on wiki/index.md if absent
# Input: VAULT_DIR SOURCE_FILE SHA256 INGESTED_INTO (colon-separated)
# Output: WROTE/SCHEMA_MIGRATED/ERROR lines

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
SOURCE_FILE="${2:-}"
SHA256="${3:-}"
INGESTED_INTO="${4:-}"  # colon-separated list of output paths

if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi
if [ -z "$SOURCE_FILE" ]; then echo "ERROR: SOURCE_FILE not set" >&2; exit 1; fi
if [ -z "$SHA256" ]; then echo "ERROR: SHA256 not set" >&2; exit 1; fi

STATE="$VAULT_DIR/wiki/.state.json"
TMP="$VAULT_DIR/wiki/.state.json.tmp"
INDEX="$VAULT_DIR/wiki/index.md"
LOCKDIR="$VAULT_DIR/wiki/.state.json.lockdir"

# Build ingested_into JSON array from colon-separated list
if [ -n "$INGESTED_INTO" ]; then
  arr="$(echo "$INGESTED_INTO" | tr ':' '\n' | jq -R . | jq -s .)"
else
  arr="[]"
fi

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "2026-01-01T00:00:00Z")"

# Load existing state or bootstrap
if [ -f "$STATE" ] && jq empty "$STATE" 2>/dev/null; then
  base_state="$(cat "$STATE")"
else
  base_state='{"version":1,"files":{}}'
fi

# Merge new entry
updated_state="$(echo "$base_state" | jq \
  --arg src "$SOURCE_FILE" \
  --arg sha "$SHA256" \
  --arg ts "$NOW" \
  --argjson into "$arr" \
  '.files[$src] = {"sha256": $sha, "ingested_at": $ts, "ingested_into": $into}')"

# Atomic write: tmp → rename
echo "$updated_state" > "$TMP"
mv "$TMP" "$STATE"
echo "WROTE: $STATE (entry: $SOURCE_FILE)"

# Schema migration: ensure wiki/index.md has _schema: 2
if [ -f "$INDEX" ]; then
  has_schema="$(awk '/^---/{c++; if(c==2)exit} c==1' "$INDEX" | grep -c '^_schema:' || true)"
  current_val="$(awk '/^---/{c++; if(c==2)exit} c==1' "$INDEX" \
    | grep '^_schema:' | head -1 | awk '{print $2}' || true)"
  if [ "$has_schema" -eq 0 ] || [ "$current_val" != "2" ]; then
    # Inject _schema: 2 after first --- line
    if sed --version 2>/dev/null | grep -q GNU; then
      sed -i '1a _schema: 2' "$INDEX"
    else
      sed -i '' '1a\
_schema: 2' "$INDEX"
    fi
    echo "SCHEMA_MIGRATED: wiki/index.md _schema set to 2"
  else
    echo "SCHEMA_OK: wiki/index.md already has _schema: 2"
  fi
fi
