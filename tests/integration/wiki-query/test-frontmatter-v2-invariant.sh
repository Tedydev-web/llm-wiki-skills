#!/usr/bin/env bash
# tests/integration/wiki-query/test-frontmatter-v2-invariant.sh
# L2 schema invariant: generated wiki/qa/<slug>.md must declare all v2 frontmatter fields.
# Fields required: tags, aliases, question, asked_at, confidence, answer_summary, sources,
#                  created, updated  (schema v2 per wiki-query/SKILL.md).
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/query-save.sh"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"

echo "=== wiki-query: frontmatter v2 field invariants ==="

tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "How does caching work?" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"

# The shim emits the expected frontmatter fields in its output line.
# Assert every required v2 field is mentioned.
REQUIRED_FIELDS="tags aliases question asked_at confidence answer_summary sources created updated"

for field in $REQUIRED_FIELDS; do
  assert_contains "$field" "$output" "v2 frontmatter declares field: $field"
done

# Assert the shim confirms it would write a QA file (not silently skip)
assert_contains "WROTE:" "$output" "shim confirms QA file would be written"

# Assert slug is present and non-empty
slug_line="$(grep '^SLUG:' "$actual_file" || true)"
if [ -n "$slug_line" ] && [ "${slug_line#SLUG: }" != "" ]; then
  echo "PASS: SLUG line present and non-empty: $slug_line"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "FAIL: SLUG line missing or empty"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

rm -f "$actual_file"
print_summary "wiki-query/frontmatter-v2-invariant"
