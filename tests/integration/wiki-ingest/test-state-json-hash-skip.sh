#!/usr/bin/env bash
# tests/integration/wiki-ingest/test-state-json-hash-skip.sh
# L4 golden test: wiki-ingest idempotency — file already in state.json with matching SHA skips ingest
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHIM="$SCRIPT_DIR/shim/ingest-basic.sh"
GOLDEN="$PROJECT_ROOT/tests/golden/wiki-ingest/state-json-hash-skip.golden.txt"

source "$PROJECT_ROOT/tests/lib/test-helpers.sh"
source "$PROJECT_ROOT/tests/lib/golden-helpers.sh"

echo "=== wiki-ingest: state.json hash skip (idempotency) ==="

tmpdir=$(make_temp_vault)
trap "rm -rf '$tmpdir'" EXIT

# Compute real SHA of the sample file so we can inject a matching entry
if command -v sha256sum >/dev/null 2>&1; then
  real_hash="$(sha256sum "$tmpdir/raw/inbox/sample-note.md" | awk '{print $1}')"
else
  real_hash="$(shasum -a 256 "$tmpdir/raw/inbox/sample-note.md" | awk '{print $1}')"
fi

# Pre-load .state.json with matching SHA — shim must skip this file
jq --arg h "$real_hash" \
   '.files["raw/inbox/sample-note.md"].sha256 = $h
    | .files["raw/inbox/sample-note.md"].ingested_at = "2026-04-01T10:00:00Z"' \
   "$tmpdir/wiki/.state.json" > "$tmpdir/wiki/.state.json.tmp"
mv "$tmpdir/wiki/.state.json.tmp" "$tmpdir/wiki/.state.json"

actual_file=$(mktemp)
bash "$SHIM" "$tmpdir" "raw/inbox/sample-note.md" > "$actual_file" 2>&1 || true

output="$(cat "$actual_file")"
assert_contains "SKIP" "$output" "ingest skip: file unchanged"

rc=0
snapshot_or_diff "$actual_file" "$GOLDEN" "$tmpdir" || rc=$?
assert_equals "0" "$rc" "state-json-hash-skip output matches golden snapshot"

rm -f "$actual_file"
print_summary "wiki-ingest/state-json-hash-skip"
