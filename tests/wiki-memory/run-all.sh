#!/bin/bash
# run-all.sh — orchestrate all wiki-memory tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_TEST_NAMES=()

# Helper: run test and track results
run_test() {
    local test_file="$1"
    local test_name=$(basename "$test_file" .sh)

    echo ""
    echo "========================================"
    echo "Running: $test_name"
    echo "========================================"

    ((TOTAL_TESTS++))

    if bash "$test_file" 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}: $test_name"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ FAILED${NC}: $test_name"
        ((FAILED_TESTS++))
        FAILED_TEST_NAMES+=("$test_name")
    fi
}

# Run unit tests
echo -e "${YELLOW}=== UNIT TESTS ===${NC}"
for test in "$SCRIPT_DIR/unit"/*.sh; do
    if [ -f "$test" ]; then
        run_test "$test"
    fi
done

# Run integration tests
echo ""
echo -e "${YELLOW}=== INTEGRATION TESTS ===${NC}"
for test in "$SCRIPT_DIR/integration"/*.sh; do
    if [ -f "$test" ]; then
        run_test "$test"
    fi
done

# Print summary
echo ""
echo "========================================"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo "========================================"
echo "Total:  $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed tests:${NC}"
    for name in "${FAILED_TEST_NAMES[@]}"; do
        echo "  - $name"
    done
    exit 1
else
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
