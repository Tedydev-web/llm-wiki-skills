#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-ingest-basic.sh
# L4 golden test: wiki-ingest incremental state check (skip unchanged / ingest changed)
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/ingest-basic.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-ingest/ingest-basic.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-ingest: incremental state check ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Compute real sha256 of the sample file
if command -v sha256sum >/dev/null 2>&1; then
  real_hash="$(sha256sum "$tmpdir/raw/inbox/sample-note.md" | awk '{print $1}')"
else
  real_hash="$(shasum -a 256 "$tmpdir/raw/inbox/sample-note.md" | awk '{print $1}')"
fi

# --- Test A: file with matching hash → SKIP ---
# Update .state.json with correct hash
jq --arg h "$real_hash" \
   '.files["raw/inbox/sample-note.md"].sha256 = $h' \
   "$tmpdir/wiki/.state.json" > "$tmpdir/wiki/.state.json.tmp"
mv "$tmpdir/wiki/.state.json.tmp" "$tmpdir/wiki/.state.json"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/sample-note.md" > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"
assert_contains "SKIP" "$output" "unchanged file produces SKIP"
rm -f "$actual_file"

# --- Test B: file with different hash → INGEST ---
jq '.files["raw/inbox/sample-note.md"].sha256 = "deadbeef"' \
   "$tmpdir/wiki/.state.json" > "$tmpdir/wiki/.state.json.tmp"
mv "$tmpdir/wiki/.state.json.tmp" "$tmpdir/wiki/.state.json"

actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/sample-note.md" > "$actual_file2" 2>&1 || true
output2="$(cat "$actual_file2")"
assert_contains "INGEST" "$output2" "changed file produces INGEST"

# L4 golden snapshot on the INGEST path output
rc=0
snapshot_or_diff "$actual_file2" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "ingest-basic output matches golden snapshot"

rm -f "$actual_file2"
print_summary "wiki-ingest/ingest-basic"
