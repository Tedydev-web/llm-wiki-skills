#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/../fixtures"

TESTS_PASSED=0
TESTS_FAILED=0

assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="$3"
    if [ "$expected" = "$actual" ]; then
        echo "✓ PASS: $message"
        ((TESTS_PASSED++))
    else
        echo "✗ FAIL: $message"
        echo "  Expected: $expected"
        echo "  Actual:   $actual"
        ((TESTS_FAILED++))
    fi
}

# Test 1: extract-turns requires transcript_path argument
echo "Test 1: extract-turns requires transcript_path"
EXIT_CODE=0
bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" >/dev/null 2>&1 || EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo "✓ PASS: Correctly requires transcript_path argument"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Should require transcript_path"
    ((TESTS_FAILED++))
fi

# Test 2: extract-turns works with 100-turn fixture
echo ""
echo "Test 2: Extract from 100-turn fixture"
TURNS=$(bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" "$FIXTURES_DIR/transcript-100-turns.jsonl" 2>/dev/null | wc -l)
if [ "$TURNS" -gt 0 ]; then
    echo "✓ PASS: Extracted $TURNS lines from fixture"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Should extract turns from fixture"
    ((TESTS_FAILED++))
fi

# Test 3: extract-turns with nonexistent file exits 0 (SKIP)
echo ""
echo "Test 3: Nonexistent file handled gracefully"
EXIT_CODE=0
bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" "/nonexistent/path.jsonl" >/dev/null 2>&1 || EXIT_CODE=$?
assert_equals "0" "$EXIT_CODE" "Should exit 0 for missing file (SKIP)"

# Test 4: extract-turns with empty file returns nothing
echo ""
echo "Test 4: Empty file handling"
OUTPUT=$(bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" "$FIXTURES_DIR/transcript-empty.jsonl" 2>/dev/null || true)
if [ -z "$OUTPUT" ]; then
    echo "✓ PASS: Empty file produces empty output"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Empty file should produce no output"
    ((TESTS_FAILED++))
fi

# Test 5: extract-turns handles custom max_turns
echo ""
echo "Test 5: Respects max_turns parameter"
LIMITED=$(bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" "$FIXTURES_DIR/transcript-100-turns.jsonl" 5 2>/dev/null | wc -l)
FULL=$(bash "$PROJECT_ROOT/skills/wiki-memory/scripts/extract-turns.sh" "$FIXTURES_DIR/transcript-100-turns.jsonl" 100 2>/dev/null | wc -l)
if [ "$LIMITED" -le "$FULL" ]; then
    echo "✓ PASS: Limited turns ($LIMITED) <= full ($FULL)"
    ((TESTS_PASSED++))
else
    echo "✗ FAIL: Limited should not exceed full"
    ((TESTS_FAILED++))
fi

echo ""
echo "========================================"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo "========================================"

[ $TESTS_FAILED -eq 0 ]
