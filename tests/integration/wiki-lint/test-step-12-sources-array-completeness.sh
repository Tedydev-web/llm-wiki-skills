#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-12-sources-array-completeness.sh
# L4 golden test: wiki-lint step 12 — sources array completeness
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-12.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-12.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-12: sources array completeness ==="

tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject the incomplete entity (only lists sample-note.md in sources)
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-12-sources-array-incomplete.md" \
   "$tmpdir/wiki/entities/incomplete-sources-entity.md"

# Inject second-source.md which links [[Incomplete Sources Entity]] but is NOT in entity's sources array
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/wiki/sources/second-source.md" \
   "$tmpdir/wiki/sources/second-source.md"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "MISSING_SOURCE_REF" "$output" "step-12 detects missing source refs (F3 pattern)"

rc=0

snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-12 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-12"
