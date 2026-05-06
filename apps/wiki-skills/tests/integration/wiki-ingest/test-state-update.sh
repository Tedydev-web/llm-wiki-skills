#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-state-update.sh
# L4 golden test: wiki-ingest Step N state write (atomic write + schema migration)
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/state-update.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-ingest/state-update.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-ingest: state write (atomic + schema migration) ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

FAKE_HASH="aabbccdd1122334455667788aabbccdd1122334455667788aabbccdd11223344"
OUTPUTS="wiki/sources/new-article.md:wiki/entities/new-entity.md"

# --- Test A: atomic write creates/merges .state.json entry ---
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/new-article.md" "$FAKE_HASH" "$OUTPUTS" \
  > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"

assert_contains "WROTE" "$output" "state-update writes .state.json"
assert_file_exists "$tmpdir/wiki/.state.json" "state.json exists after write"

# Verify entry was written correctly
entry_hash="$(jq -r '.files["raw/inbox/new-article.md"].sha256' "$tmpdir/wiki/.state.json" 2>/dev/null || echo "")"
assert_equals "$FAKE_HASH" "$entry_hash" "state.json contains correct sha256 for new entry"

# Verify existing entry not clobbered
old_entry="$(jq -r '.files["raw/inbox/sample-note.md"] | .sha256' "$tmpdir/wiki/.state.json" 2>/dev/null || echo "")"
assert_equals "abc123def456abc123def456abc123def456abc123def456abc123def456abc123" \
  "$old_entry" "existing state entry preserved after write"

# --- Test B: schema migration sets _schema: 2 if absent ---
# Remove _schema from index.md to simulate pre-migration vault
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i '/_schema/d' "$tmpdir/wiki/index.md"
else
  sed -i '' '/_schema/d' "$tmpdir/wiki/index.md"
fi

actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/another.md" "$FAKE_HASH" "" \
  > "$actual_file2" 2>&1 || true
output2="$(cat "$actual_file2")"
assert_contains "SCHEMA_MIGRATED" "$output2" "state-update migrates _schema to 2 when absent"

# Combine both outputs into a single file for golden snapshot
combined_file=$(mktemp)
printf '%s\n%s\n' "$output" "$output2" > "$combined_file"

rm -f "$actual_file" "$actual_file2"

snapshot_or_diff "$combined_file" "$GOLDEN" "$tmpdir"
rm -f "$combined_file"
print_summary "wiki-ingest/state-update"
