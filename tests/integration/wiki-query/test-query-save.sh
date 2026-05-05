#!/usr/bin/env bash
# tests/integration/wiki-query/test-query-save.sh
# L4 golden test: wiki-query --save flag slug generation + v2 frontmatter validation
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/query-save.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-query/query-save.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-query: --save flag ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

QUESTION="How does sample concept work?"

# --- Test A: slug generation ---
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "$QUESTION" > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"

assert_contains "SLUG: how-does-sample-concept-work" "$output" \
  "slug generated correctly from question"
assert_contains "WROTE" "$output" \
  "save mode outputs WROTE path"
assert_contains "frontmatter v2 fields" "$output" \
  "save mode confirms all 9 v2 frontmatter fields"
assert_contains "index entry" "$output" \
  "save mode confirms index update"

# --- Test B: collision detection (same question twice) ---
# Create the qa file to simulate collision
mkdir -p "$tmpdir/wiki/qa"
touch "$tmpdir/wiki/qa/how-does-sample-concept-work.md"

actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir" "$QUESTION" > "$actual_file2" 2>&1 || true
output2="$(cat "$actual_file2")"
assert_contains "COLLISION" "$output2" \
  "collision detected when slug already exists"

# L4 golden snapshot (non-collision path)
rc=0
snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "query-save output matches golden snapshot"

rm -f "$actual_file" "$actual_file2"
print_summary "wiki-query/query-save"
