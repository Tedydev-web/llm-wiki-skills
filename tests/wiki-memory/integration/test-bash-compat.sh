#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/skills/wiki-memory/scripts"

echo "Integration: Bash syntax compatibility check"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Check all scripts for syntax errors
for script in "$SCRIPTS_DIR"/*.sh; do
    SCRIPT_NAME=$(basename "$script")
    if bash -n "$script" 2>/dev/null; then
        echo "✓ PASS: $SCRIPT_NAME has valid syntax"
        ((TESTS_PASSED++))
    else
        echo "✗ FAIL: $SCRIPT_NAME has syntax errors"
        ((TESTS_FAILED++))
    fi
done

echo ""
echo "Scripts Validated: $TESTS_PASSED / Errors: $TESTS_FAILED"
[ $TESTS_FAILED -eq 0 ]
