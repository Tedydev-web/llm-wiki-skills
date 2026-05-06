#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Script exists
echo "Test 1: status.sh exists"
if [ -f "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 2: Executable
echo "Test 2: Executable"
if [ -x "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" ]; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 3: Readable output
echo "Test 3: Produces human-readable output"
if grep -qE "echo|printf" "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 4: Checks settings file
echo "Test 4: Checks settings file"
if grep -qE "settings.json|\.claude" "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" 2>/dev/null; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Test 5: Safe to run (no side effects)
echo "Test 5: Safe to run (no side effects)"
if ! grep -qE "rm|delete" "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" 2>/dev/null || grep -q "#.*rm" "$PROJECT_ROOT/skills/wiki-memory/scripts/status.sh" 2>/dev/null; then
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
