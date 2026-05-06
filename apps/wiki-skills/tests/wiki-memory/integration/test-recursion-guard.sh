#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/skills/wiki-memory/scripts"

echo "Integration: Recursion guard verification"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# All hooks should have recursion guard
for hook in hook-session-end.sh hook-session-start.sh hook-pre-compact.sh; do
    SCRIPT_PATH="$SCRIPTS_DIR/$hook"
    if grep -q "WIKI_MEMORY_INVOKED_BY" "$SCRIPT_PATH"; then
        echo "✓ PASS: $hook has recursion guard"
        ((TESTS_PASSED++))
    else
        echo "✗ FAIL: $hook missing recursion guard"
        ((TESTS_FAILED++))
    fi
done

echo ""
echo "Tests Passed: $TESTS_PASSED / Tests Failed: $TESTS_FAILED"
[ $TESTS_FAILED -eq 0 ]
