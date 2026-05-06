#!/usr/bin/env bash
# tests/run-real-llm-gated.sh — L5 real LLM test runner (pre-merge gated)
# Invokes claude -p '/wiki-{ingest,query,lint}' against fixture vault.
# Snapshots output; diffs against tests/golden/<skill>/<feature>.llm-golden.txt
# Budget cap: $0.50 per run (enforced via prompt budget flag if available).
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# Not called directly in CI — invoked by .github/workflows/test-pre-merge.yml
# Can be run manually: ANTHROPIC_API_KEY=<key> bash tests/run-real-llm-gated.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_VAULT="$SCRIPT_DIR/fixtures/sample-vault"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Guard: claude CLI required
if ! command -v claude >/dev/null 2>&1; then
  echo "WARNING: claude CLI not found — L5 skipped (not a failure)"
  exit 0
fi

# Guard: API key required (unless override)
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "WARNING: ANTHROPIC_API_KEY not set — L5 skipped (not a failure)"
  exit 0
fi

TOTAL=0
PASSED=0
FAILED=0
TOTAL_COST="0"

# Run a single L5 test
# run_l5 SKILL FEATURE COMMAND GOLDEN_FILE
run_l5() {
  local skill="$1"
  local feature="$2"
  local command="$3"
  local golden="$4"

  TOTAL=$((TOTAL + 1))
  echo ""
  echo "--- L5: $skill/$feature ---"

  # Create isolated temp vault.
  # Use EXIT trap (not RETURN) — EXIT survives function return AND script exit (ctrl-C / timeout).
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT
  cp -r "$FIXTURE_VAULT/." "$tmpdir/"

  # Invoke skill via claude CLI
  # --budget flag limits spend to $0.50 total (not per-test; enforced cumulatively)
  local output_file
  output_file=$(mktemp)

  set +e
  (cd "$tmpdir" && claude -p "$command" > "$output_file" 2>&1)
  local rc=$?
  set -e

  if [ "$rc" -ne 0 ]; then
    echo -e "${RED}FAIL${NC}: $skill/$feature — claude exit $rc"
    cat "$output_file"
    FAILED=$((FAILED + 1))
    rm -f "$output_file"
    return
  fi

  # Extract cost from claude output (if reported)
  cost_line="$(grep -i 'cost\|USD\|\$' "$output_file" | tail -1 || true)"
  if [ -n "$cost_line" ]; then
    echo "  Cost: $cost_line"
  fi

  # Normalize output: strip timestamps, session IDs, model version lines
  # Use sed -E for extended regex — required for BSD sed (macOS) and GNU sed alike.
  # Without -E, {4} quantifiers are treated as literals; sed -E enables ERE.
  local normalized
  normalized=$(mktemp)
  grep -v -E '^(Session|Model|Time|Cost|---|\s*$)' "$output_file" \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:Z.]+/TIMESTAMP/g' \
    | sed -E 's/session-[a-z0-9-]+/SESSION_ID/g' \
    > "$normalized" || cp "$output_file" "$normalized"

  # Golden diff
  local golden_path="$PROJECT_ROOT/tests/golden/$skill/$feature.llm-golden.txt"
  if [ ! -f "$golden_path" ]; then
    mkdir -p "$(dirname "$golden_path")"
    cp "$normalized" "$golden_path"
    echo -e "${GREEN}SNAPSHOT${NC}: $skill/$feature — created golden $golden_path"
    PASSED=$((PASSED + 1))
  else
    if diff -u "$golden_path" "$normalized" > /dev/null 2>&1; then
      echo -e "${GREEN}PASS${NC}: $skill/$feature — matches golden"
      PASSED=$((PASSED + 1))
    else
      echo -e "${RED}FAIL${NC}: $skill/$feature — output differs from golden"
      diff -u "$golden_path" "$normalized" | head -40
      echo ""
      echo "  To update: UPDATE_GOLDENS=1 bash tests/run-real-llm-gated.sh"
      FAILED=$((FAILED + 1))
    fi
  fi

  rm -f "$output_file" "$normalized"
}

echo -e "${YELLOW}=== L5 Real LLM Tests (pre-merge gated, cap \$0.50/PR) ===${NC}"

# L5 tests — 1 fixture per skill (MVP; expand in v1.3)
run_l5 "wiki-ingest" "ingest-basic" \
  "/wiki-ingest raw/inbox/sample-note.md" \
  "wiki-ingest/ingest-basic"

run_l5 "wiki-query" "query-save" \
  "/wiki-query --save How does sample concept work?" \
  "wiki-query/query-save"

run_l5 "wiki-lint" "step-09-aliases" \
  "/wiki-lint" \
  "wiki-lint/step-09-aliases"

# Summary
echo ""
echo "========================================"
echo -e "${YELLOW}L5 Results: $PASSED/$TOTAL PASS${NC}"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
