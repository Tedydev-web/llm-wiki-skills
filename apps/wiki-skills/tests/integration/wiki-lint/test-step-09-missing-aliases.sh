#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-09-missing-aliases.sh
# L4 golden test: wiki-lint step 09 — missing aliases
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-09.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-09.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-09: missing aliases ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-09-missing-aliases.md" "$tmpdir/wiki/entities/bad-step-09.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "MISSING_ALIASES" "$output" "step-09 detects entity missing aliases frontmatter field"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-09 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-09"
