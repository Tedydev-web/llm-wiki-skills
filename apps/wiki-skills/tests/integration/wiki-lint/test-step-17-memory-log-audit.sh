#!/usr/bin/env bash
# tests/integration/wiki-lint/test-step-17-memory-log-audit.sh
# L4 golden test: wiki-lint step 17 — .memory.log cross-reference audit
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# P03 close-out: SKIP guard removed (2026-05-05). Golden populated from real shim run.
# Fixture .memory.log has:
#   - one good entry  (session file exists → no warning)
#   - one orphan entry (missing-deleted-session.md → WARNING 17a)
#   - one orphan session file (2026-04-02-0900-orphan-session.md, no log entry → WARNING 17b)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/step-17.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-lint/step-17.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-lint step-17: .memory.log cross-reference audit ==="

# --- Test A: vault with no .memory.log → INFO (graceful skip) ---
tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

rm -f "$tmpdir/wiki/.memory.log"

actual_a=$(mktemp)
bash "$SHIM" "$tmpdir" > "$actual_a" 2>&1 || true
output_a="$(cat "$actual_a")"
assert_contains "INFO step-17" "$output_a" "step-17 skips gracefully when .memory.log absent"
rm -f "$actual_a"
rm -rf "$tmpdir"
trap - EXIT

# --- Test B: fixture vault with orphan entry + orphan session file ---
# Uses the canonical fixture .memory.log (already has both warning scenarios).
# The golden was captured from this exact vault run.
tmpdir2=$(make_temp_vault)
trap "rm -rf '$tmpdir2'" EXIT

actual_b=$(mktemp)
bash "$SHIM" "$tmpdir2" > "$actual_b" 2>&1 || true
output_b="$(cat "$actual_b")"

# 17a: orphaned log entry detected
assert_contains "WARNING step-17: orphaned log entry" "$output_b" \
  "step-17 detects orphaned log entry (missing-deleted-session.md)"

# 17b: orphaned session file detected
assert_contains "WARNING step-17: orphaned session file" "$output_b" \
  "step-17 detects orphaned session file (2026-04-02-0900-orphan-session.md)"

# L4 golden snapshot — diff against canonical expected output
rc=0
snapshot_or_diff "$actual_b" "$GOLDEN" "$tmpdir2" || rc=$?
assert_equals "0" "$rc" "step-17 output matches golden snapshot"

rm -f "$actual_b"
print_summary "wiki-lint/step-17"
