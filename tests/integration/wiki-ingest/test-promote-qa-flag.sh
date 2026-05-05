#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-promote-qa-flag.sh
# L4 golden test: wiki-ingest --promote-qa workflow validation
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/promote-qa.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-ingest/promote-qa.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-ingest: --promote-qa flag ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

SLUG="how-does-sample-concept-work"

# --- Test A: happy path — valid QA file exists ---
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "$SLUG" > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"

assert_contains "PROMOTED" "$output" "promote-qa outputs PROMOTED for valid QA file"
assert_contains "wiki/concepts/$SLUG.md" "$output" "promote-qa shows target concept path"
assert_contains "promoted-from-qa" "$output" "promote-qa shows correct tags"
assert_contains "wiki/qa/$SLUG.md (kept" "$output" "promote-qa confirms QA file kept intact"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "promote-qa output matches golden snapshot"
rm -f "$actual_file"

# --- Test B: missing slug → error ---
actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir" "nonexistent-slug" > "$actual_file2" 2>&1 || true
output2="$(cat "$actual_file2")"
assert_contains "ERROR" "$output2" "promote-qa reports ERROR for missing QA slug"
rm -f "$actual_file2"

print_summary "wiki-ingest/promote-qa"
