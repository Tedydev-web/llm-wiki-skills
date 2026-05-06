#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-14-qa-integrity.sh
# L4 golden test: wiki-lint step 14 — QA artifact integrity (14a orphan, 14b frontmatter, 14c schema)
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-14.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-14.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-14: QA artifact integrity ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad QA fixture (invalid confidence + missing fields + sources as string)
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-14-qa-bad-frontmatter.md" \
   "$tmpdir/wiki/qa/bad-frontmatter-test.md"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"

# Should detect bad confidence value
assert_contains "ERROR step-14b" "$output" "step-14 detects QA frontmatter errors"

# Should detect missing answer_summary field
assert_contains "answer_summary" "$output" "step-14 reports missing answer_summary field"

# Should detect bad sources (bare string)
assert_contains "sources" "$output" "step-14 detects sources as non-list"

# 14c: valid fixture has _schema: 2 — should pass
assert_contains "OK step-14c" "$output" "step-14c passes for valid _schema: 2"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-14 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-14"
