#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-01-broken-wikilinks.sh
# L4 golden test: wiki-lint step 1 broken wikilinks detection
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-01.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-01.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-01: broken wikilinks ==="

# Setup: temp vault with bad fixture injected
tmpdir=$(make_temp_vault)
trap 'rm -rf "$tmpdir"' EXIT

# Inject bad fixture: page with broken wikilink
cp "$PROJECT_ROOT/tests/fixtures/sample-vault/_bad/step-01-broken-wikilink.md" \
   "$tmpdir/wiki/entities/step-01-broken-wikilink.md"

# Run shim
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_file" 2>&1 || true

# Verify shim detected the broken link
output="$(cat "$actual_file")"
assert_contains "BROKEN" "$output" "step-01 detects broken wikilink [[NonExistentPage]]"

# L4 golden snapshot
rc=0
snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "step-01 output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-lint/step-01"
