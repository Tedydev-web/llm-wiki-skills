#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Script exists
echo "Test 1: enable-hooks.sh exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/enable-hooks.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 2: Executable
echo "Test 2: Executable"
if [ -x "$PROJECT_ROOT/skills/wiki-memory/scripts/enable-hooks.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 3: Has jq merge integration
echo "Test 3: Uses lib-jq-merge for JSON manipulation"
if grep -q "lib-jq-merge\|source.*lib-jq" "$PROJECT_ROOT/skills/wiki-memory/scripts/enable-hooks.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 4: Supports --scope flag
echo "Test 4: Supports --scope flag"
if grep -q "\-\-scope" "$PROJECT_ROOT/skills/wiki-memory/scripts/enable-hooks.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 5: Has backup functionality
echo "Test 5: Backup functionality"
if grep -qE "backup|BACKUP" "$PROJECT_ROOT/skills/wiki-memory/scripts/enable-hooks.sh" 2>/dev/null; then
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
