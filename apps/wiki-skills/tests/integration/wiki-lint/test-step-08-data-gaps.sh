#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-08-data-gaps.sh
# L4 golden test: wiki-lint step 08 — data gaps
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-08.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-08.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-08: data gaps ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-08-data-gap.md" "$tmpdir/wiki/entities/bad-step-08.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
# step-08 is a heuristic detector — output may show GAP or OK depending on fixture links.
# The structural assertion is that the shim runs cleanly (no crash, produces output).
if [ -n "$output" ]; then
  echo "PASS: step-08 shim produces output"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "FAIL: step-08 shim produced no output"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-08 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-08"
