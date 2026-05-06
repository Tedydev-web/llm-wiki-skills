#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-15-state-json-drift.sh
# L4 golden test: wiki-lint step 15 — state.json drift detection
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-15.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-15.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-15: state.json drift detection ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject drifted state.json: references deleted source files
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-15-state-json-drift.json" \
   "$tmpdir/wiki/.state.json"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"

# Should detect orphan state entry (deleted-source.md doesn't exist)
assert_contains "WARNING step-15a" "$output" "step-15 detects orphan state entry for deleted source"

# Should detect dangling output refs (deleted-entity.md, deleted-concept.md don't exist)
assert_contains "INFO step-15b" "$output" "step-15 detects dangling output references"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-15 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-15"
