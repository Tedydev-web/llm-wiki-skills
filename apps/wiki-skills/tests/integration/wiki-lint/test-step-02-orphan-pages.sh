#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-02-orphan-pages.sh
# L4 golden test: wiki-lint step 02 — orphan pages
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-02.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-02.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-02: orphan pages ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-02-orphan-page.md" "$tmpdir/wiki/entities/bad-step-02.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "ORPHAN" "$output" "step-02 detects orphan page with no inbound links"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-02 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-02"
