#!/usr/bin/env bash
# tests/integration/wiki-query/test-special-chars.sh
# L4 golden test: wiki-query slug generation handles Unicode, apostrophes, quotes, slashes.
# Slug must be kebab-case ASCII only — all special chars stripped.
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/query-save.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-query/special-chars.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-query: special chars in question → stable slug ==="

# --- Test A: Unicode characters stripped ---
tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "What is rendering?" > "$actual_file" 2>&1 || true
output="$(cat "$actual_file")"

# Slug must be ASCII kebab-case only — Unicode stripped
slug_line="$(grep '^SLUG:' "$actual_file" || true)"
slug_val="${slug_line#SLUG: }"
# Verify slug contains only lowercase ASCII, digits, and hyphens
if echo "$slug_val" | grep -qE '^[a-z0-9-]+$'; then
  echo "PASS: Unicode question produces ASCII-only slug: $slug_val"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "FAIL: Slug contains non-ASCII characters: $slug_val"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
rm -f "$actual_file"
rm -rf "$tmpdir"
trap - EXIT

# --- Test B: apostrophes, quotes, slashes stripped ---
tmpdir2=$(make_temp_vault)
trap "rm -rf '$tmpdir2'" EXIT

actual_file2=$(mktemp)
bash "$SHIM" "$tmpdir2" "What's the \"best\" approach/method?" > "$actual_file2" 2>&1 || true

slug_line2="$(grep '^SLUG:' "$actual_file2" || true)"
slug_val2="${slug_line2#SLUG: }"
if echo "$slug_val2" | grep -qE '^[a-z0-9-]+$'; then
  echo "PASS: Punctuation question produces ASCII-only slug: $slug_val2"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "FAIL: Slug contains punctuation: $slug_val2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# L4 golden snapshot on the punctuation path (stable across runs)
rc=0
snapshot_or_diff "$actual_file2" "$GOLDEN" "$tmpdir2" || rc=$?
assert_equals "0" "$rc" "special-chars slug output matches golden snapshot"

rm -f "$actual_file2"
print_summary "wiki-query/special-chars"
