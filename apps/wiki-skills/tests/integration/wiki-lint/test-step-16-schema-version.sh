#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-16-schema-version.sh
# L4 golden test: wiki-lint step 16 — _schema field in wiki/index.md
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-16.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-16.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-16: _schema version in index.md ==="

# --- Test A: Bad fixture — _schema: 1 triggers error ---
tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-16-schema-version-mismatch.md" \
   "$tmpdir/wiki/index.md"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || rc=$?

output="$(cat "$actual_file")"
assert_contains "ERROR step-16" "$output" "step-16 reports error for _schema: 1"

rm -f "$actual_file"
rm -rf "$tmpdir"
trap - EXIT

# --- Test B: Good fixture — _schema: 2 passes ---
tmpdir2=$(make_temp_vault)
trap 'rm -rf "$tmpdir2"' EXIT

actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir2" > "$actual_file2" 2>&1 || true

output2="$(cat "$actual_file2")"
assert_contains "OK step-16" "$output2" "step-16 passes for valid _schema: 2"

rc=0

snapshot_or_diff "$actual_file2" "$GOLDEN" "$tmpdir2" || rc=$?
assert_equals "0" "$rc" "step-16 good-path output matches golden snapshot"

rm -f "$actual_file2"
print_summary "wiki-lint/step-16"
