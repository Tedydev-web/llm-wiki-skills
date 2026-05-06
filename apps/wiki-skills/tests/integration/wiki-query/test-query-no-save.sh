#!/usr/bin/env bash
# tests/integration/wiki-query/test-query-no-save.sh
# L4 golden test: wiki-query without --save flag writes no files
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/query-no-save.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-query/query-no-save.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-query: no --save flag (read-only) ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"

assert_contains "NO_WRITE_CONFIRMED" "$output" \
  "no-save query confirms no files written to qa/"
assert_contains "READ_ONLY" "$output" \
  "no-save query confirms index and log not modified"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "query-no-save output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-query/query-no-save"
