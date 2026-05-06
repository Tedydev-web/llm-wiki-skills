#!/usr/bin/env bash
# tests/integration/wiki-ingest/run-all.sh — run all wiki-ingest tests (L4)
# Compatible: macOS bash 3.2 + Linux bash 4+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TOTAL=0
PASSED=0
FAILED=0
FAILED_NAMES=""

run_test() {
  local test_file="$1"
  local test_name
  test_name="$(basename "$test_file" .sh)"
  TOTAL=$((TOTAL + 1))
  echo ""
  echo "--- $test_name ---"
  if bash "$test_file" 2>&1; then
    echo -e "${GREEN}PASS${NC}: $test_name"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}FAIL${NC}: $test_name"
    FAILED=$((FAILED + 1))
    FAILED_NAMES="$FAILED_NAMES $test_name"
  fi
}

echo -e "${YELLOW}=== wiki-ingest integration tests (L4) ===${NC}"

for test_file in "$SCRIPT_DIR"/test-*.sh; do
  [ -f "$test_file" ] && run_test "$test_file"
done

echo ""
echo "========================================"
echo -e "${YELLOW}[wiki-ingest] Results: $PASSED/$TOTAL PASS${NC}"
echo "========================================"
if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}Failed:${NC}$FAILED_NAMES"
  exit 1
fi
exit 0
