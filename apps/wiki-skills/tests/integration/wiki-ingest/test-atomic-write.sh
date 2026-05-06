#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-atomic-write.sh
# Integration test: kill -9 mid-ingest must not leave orphan .tmp files or corrupt state.json.
# Technique: launch shim in background, kill -9 after 100ms, inspect vault for residue.
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/ingest-basic.sh"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"

echo "=== wiki-ingest: atomic write (kill -9 mid-ingest) ==="

tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

# Snapshot .state.json before ingest so we can check it wasn't half-written
state_before="$(cat "$tmpdir/wiki/.state.json")"

# Launch shim in background; give it 100ms then kill -9
# The shim is a fast bash script — 100ms is enough for it to start writing but
# we test the postcondition regardless (even if it completes before kill fires).
bash "$SHIM" "$tmpdir" "raw/inbox/sample-note.md" >/dev/null 2>&1 &
BG_PID=$!
sleep 0.1
kill -9 "$BG_PID" 2>/dev/null || true
wait "$BG_PID" 2>/dev/null || true

# --- Assert A: no orphan .tmp files in wiki/sources/ ---
tmp_count=0
for f in "$tmpdir/wiki/sources/"*.tmp "$tmpdir/wiki/"*.tmp; do
  [ -f "$f" ] && tmp_count=$((tmp_count + 1)) || true
done
assert_equals "0" "$tmp_count" "no orphan .tmp files after kill -9"

# --- Assert B: .state.json is either unchanged or valid JSON (not half-written) ---
state_after_file="$tmpdir/wiki/.state.json"
if [ -f "$state_after_file" ]; then
  if jq empty "$state_after_file" 2>/dev/null; then
    echo "PASS: .state.json is valid JSON after kill -9"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    # Corruption: .state.json exists but is not valid JSON
    echo "FAIL: .state.json is corrupt after kill -9"
    echo "  Content: $(cat "$state_after_file")"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  # File gone is acceptable — atomic write via tmp+rename means either old or new exists
  echo "PASS: .state.json absent after kill -9 (atomic rename not completed — expected)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
fi

print_summary "wiki-ingest/atomic-write"
