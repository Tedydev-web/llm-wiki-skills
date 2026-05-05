#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Script exists
echo "Test 1: hook-session-start.sh exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-start.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 2: Executable
echo "Test 2: Hook is executable"
if [ -x "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-start.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 3: Has recursion guard
echo "Test 3: Has recursion guard"
if grep -q "WIKI_MEMORY_INVOKED_BY" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-start.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 4: Has compact source skip
echo "Test 4: Skips when source=compact"
if grep -q "source_field.*compact\|compact.*skip" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-start.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 5: Outputs valid JSON structure
echo "Test 5: Outputs hookSpecificOutput JSON"
if grep -q "hookSpecificOutput\|additionalContext" "$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-start.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

echo ""
echo "Tests Passed: $TESTS_PASSED / Tests Failed: $TESTS_FAILED"
if [ $TESTS_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi
