#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-03-contradictions.sh
# L4 golden test: wiki-lint step 03 — contradictions
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-03.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-03.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-03: contradictions ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-03-contradiction.md" "$tmpdir/wiki/entities/bad-step-03.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "CONTRADICTION" "$output" "step-03 detects contradiction markers"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-03 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-03"
