#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/skills/wiki-memory/scripts"

echo "Integration: Verify all required scripts exist and are executable"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

for script in hook-session-end.sh hook-session-start.sh hook-pre-compact.sh extract-turns.sh enable-hooks.sh disable-hooks.sh status.sh flush-session.sh logs.sh; do
    SCRIPT_PATH="$SCRIPTS_DIR/$script"
    if [ ! -f "$SCRIPT_PATH" ]; then
        echo "✗ FAIL: Missing $script"
        ((TESTS_FAILED++))
    elif [ ! -x "$SCRIPT_PATH" ]; then
        echo "✗ FAIL: $script not executable"
        ((TESTS_FAILED++))
    else
        echo "✓ PASS: $script exists and executable"
        ((TESTS_PASSED++))
    fi
done

echo ""
echo "Tests Passed: $TESTS_PASSED / Tests Failed: $TESTS_FAILED"
[ $TESTS_FAILED -eq 0 ]
