#!/usr/bin/env bash
# tests/run-all-skills.sh — top-level L1-L4 test orchestrator for wiki-skills
# Runs: L1+L2 lint, L3 hash sync, wiki-ingest, wiki-query, wiki-lint integration tests
# Compatible: macOS bash 3.2 + Linux bash 4+
# Usage: bash tests/run-all-skills.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SUITE_TOTAL=0
SUITE_PASSED=0
SUITE_FAILED=0
FAILED_SUITES=""

run_suite() {
  local name="$1"
  local script="$2"
  SUITE_TOTAL=$((SUITE_TOTAL + 1))
  echo ""
  echo "========================================"
  echo -e "${YELLOW}Running suite: $name${NC}"
  echo "========================================"
  if bash "$script" 2>&1; then
    echo -e "${GREEN}SUITE PASS${NC}: $name"
    SUITE_PASSED=$((SUITE_PASSED + 1))
  else
    echo -e "${RED}SUITE FAIL${NC}: $name"
    SUITE_FAILED=$((SUITE_FAILED + 1))
    FAILED_SUITES="$FAILED_SUITES $name"
  fi
}

# L1+L2: Markdown lint + schema invariants
run_suite "L1+L2 lint-skills-structure" "$SCRIPT_DIR/lint-skills-structure.sh"

# L3: Rule hash sync
run_suite "L3 rule-hash-sync" "$SCRIPT_DIR/meta/test-rule-hash-sync.sh"

# L4: Per-skill integration tests
run_suite "L4 wiki-ingest" "$SCRIPT_DIR/integration/wiki-ingest/run-all.sh"
run_suite "L4 wiki-query"  "$SCRIPT_DIR/integration/wiki-query/run-all.sh"
run_suite "L4 wiki-lint"   "$SCRIPT_DIR/integration/wiki-lint/run-all.sh"

# Summary
echo ""
echo "========================================"
echo -e "${YELLOW}=== run-all-skills SUMMARY ===${NC}"
echo "========================================"
echo "Suites: $SUITE_PASSED/$SUITE_TOTAL PASS"

if [ "$SUITE_FAILED" -gt 0 ]; then
  echo -e "${RED}Failed suites:${NC}$FAILED_SUITES"
  echo ""
  echo "Fix failures above, then re-run: bash tests/run-all-skills.sh"
  exit 1
else
  echo -e "${GREEN}All suites passed (L1-L4). L5 runs via pre-merge label workflow only.${NC}"
  exit 0
fi
