#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/../fixtures"

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Hook script exists
echo "Test 1: Hook script exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh" ]; then
    echo "✓ PASS: hook-session-end.sh exists"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: hook-session-end.sh not found"
    ((TESTS_FAILED++))
fi

# Test 2: Hook is executable
echo ""
echo "Test 2: Hook is executable"
if [ -x "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh" ]; then
    echo "✓ PASS: hook-session-end.sh is executable"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: hook-session-end.sh is not executable"
    ((TESTS_FAILED++))
fi

# Test 3: Hook has proper shebang
echo ""
echo "Test 3: Hook has proper shebang"
HEAD=$(head -1 "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh")
if echo "$HEAD" | grep -q "#!/.*bash"; then
    echo "✓ PASS: Proper bash shebang"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Missing proper bash shebang"
    ((TESTS_FAILED++))
fi

# Test 4: Hook contains required components
echo ""
echo "Test 4: Hook contains required logic"
SCRIPT=$(cat "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh")
CHECKS=0
[ -z "$(echo "$SCRIPT" | grep -i "recursion guard")" ] || ((CHECKS++))
[ -z "$(echo "$SCRIPT" | grep -i "vault")" ] || ((CHECKS++))
[ -z "$(echo "$SCRIPT" | grep "mkdir")" ] || ((CHECKS++))
if [ "$CHECKS" -ge 2 ]; then
    echo "✓ PASS: Hook contains expected logic"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Hook missing expected components"
    ((TESTS_FAILED++))
fi

# Test 5: Hook uses jq for parsing
echo ""
echo "Test 5: Hook uses jq for JSON parsing"
if grep -q "jq" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh"; then
    echo "✓ PASS: Uses jq for parsing"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Should use jq"
    ((TESTS_FAILED++))
fi

echo ""
echo "========================================"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo "========================================"

[ $TESTS_FAILED -eq 0 ]
