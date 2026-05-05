#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-state-json-corrupt-recovery.sh
# L4 golden test: wiki-ingest must NOT crash when .state.json is invalid JSON.
# Expected: treat state as empty, log error to stderr, ingest proceeds normally.
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/ingest-basic.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-ingest/state-json-corrupt-recovery.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-ingest: corrupt .state.json recovery ==="

tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

# Pre-write malformed .state.json (invalid JSON — truncated object)
printf '{"version":1,"files":{"raw/inbox/sample-note.md":' \
  > "$tmpdir/wiki/.state.json"

# Capture both stdout and stderr together so the golden captures the error message
actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/sample-note.md" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"

# Must NOT crash (exit code is not checked — shim exits 0 with recovery message)
# Must report corrupt state warning
assert_contains "corrupt" "$output" "shim reports corrupt .state.json to stderr/stdout"

# Must proceed to ingest (treat state as empty)
assert_contains "INGEST" "$output" "shim ingests file when state is corrupt (treated as empty)"

rc=0
snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "state-json-corrupt-recovery output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-ingest/state-json-corrupt-recovery"
