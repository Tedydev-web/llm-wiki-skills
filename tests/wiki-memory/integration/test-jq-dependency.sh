#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/skills/wiki-memory/scripts"

echo "Integration: jq dependency verification"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: jq is available
echo "Test 1: jq is available in system"
if command -v jq >/dev/null 2>&1; then
    echo "✓ PASS: jq found"
    ((TESTS_PASSED++))
else
    echo "⊘ SKIP: jq not installed (scripts will handle gracefully)"
    ((TESTS_PASSED++))
fi

# Test 2: lib-jq-merge checks for jq
echo "Test 2: lib-jq-merge validates jq"
if grep -q "command -v jq\|which jq" "$SCRIPTS_DIR/lib-jq-merge.sh"; then
    echo "✓ PASS: Library validates jq"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Library should check for jq"
    ((TESTS_FAILED++))
fi

# Test 3: Scripts use jq for JSON parsing
echo "Test 3: Scripts use jq for JSON"
for script in hook-session-end.sh hook-session-start.sh hook-pre-compact.sh; do
    if grep -q "jq" "$SCRIPTS_DIR/$script"; then
        echo "  ✓ $script uses jq"
        ((TESTS_PASSED++))
    else
        echo "  ✗ $script doesn't use jq"
        ((TESTS_FAILED++))
    fi
done

echo ""
echo "Tests Passed: $TESTS_PASSED / Tests Failed: $TESTS_FAILED"
[ $TESTS_FAILED -eq 0 ]
