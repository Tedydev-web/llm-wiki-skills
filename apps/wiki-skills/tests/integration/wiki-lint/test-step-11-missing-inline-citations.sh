#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-11-missing-inline-citations.sh
# L4 golden test: wiki-lint step 11 — missing inline citations
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-11.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-11.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-11: missing inline citations ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-11-missing-inline-citations.md" "$tmpdir/wiki/concepts/bad-step-11.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "SUSPECT_CITATION" "$output" "step-11 detects uncited claim sentences"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-11 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-11"
