#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

echo "Integration: lib-jq-merge functionality"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Library exists
echo "Test 1: lib-jq-merge.sh exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/lib-jq-merge.sh" ]; then
    echo "✓ PASS"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL"
    ((TESTS_FAILED++))
fi

# Test 2: Library has merge functions
echo "Test 2: Library contains merge logic"
if grep -q "merge\|jq" "$PROJECT_ROOT/skills/wiki-memory/scripts/lib-jq-merge.sh"; then
    echo "✓ PASS"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL"
    ((TESTS_FAILED++))
fi

# Test 3: Library checks for jq
echo "Test 3: Library validates jq availability"
if grep -q "command -v jq\|which jq" "$PROJECT_ROOT/skills/wiki-memory/scripts/lib-jq-merge.sh"; then
    echo "✓ PASS"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL"
    ((TESTS_FAILED++))
fi

# Test 4: Library is sourceable (valid bash)
echo "Test 4: Library is valid bash"
if bash -n "$PROJECT_ROOT/skills/wiki-memory/scripts/lib-jq-merge.sh" 2>/dev/null; then
    echo "✓ PASS"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Syntax error in library"
    ((TESTS_FAILED++))
fi

echo ""
echo "Tests Passed: $TESTS_PASSED / Tests Failed: $TESTS_FAILED"
[ $TESTS_FAILED -eq 0 ]
