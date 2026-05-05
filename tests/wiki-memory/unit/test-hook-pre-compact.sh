#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Hook script exists
echo "Test 1: hook-pre-compact.sh exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-pre-compact.sh" ]; then
    echo "✓ PASS: script exists"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: script not found"
    ((TESTS_FAILED++))
fi

# Test 2: Hook is executable
echo ""
echo "Test 2: Hook is executable"
if [ -x "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-pre-compact.sh" ]; then
    echo "✓ PASS: executable"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: not executable"
    ((TESTS_FAILED++))
fi

# Test 3: Hook has recursion guard
echo ""
echo "Test 3: Hook has recursion guard"
if grep -q "WIKI_MEMORY_INVOKED_BY" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-pre-compact.sh"; then
    echo "✓ PASS: recursion guard present"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: missing recursion guard"
    ((TESTS_FAILED++))
fi

# Test 4: Hook respects MIN_TURNS
echo ""
echo "Test 4: Hook respects MIN_TURNS variable"
if grep -q "MIN_TURNS\|min.*turn" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-pre-compact.sh"; then
    echo "✓ PASS: MIN_TURNS logic present"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: missing MIN_TURNS logic"
    ((TESTS_FAILED++))
fi

# Test 5: Hook uses jq
echo ""
echo "Test 5: Hook uses jq"
if grep -q "jq" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-pre-compact.sh"; then
    echo "✓ PASS: uses jq"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: should use jq"
    ((TESTS_FAILED++))
fi

echo ""
echo "========================================"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo "========================================"

[ $TESTS_FAILED -eq 0 ]
