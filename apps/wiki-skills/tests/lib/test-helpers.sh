#!/usr/bin/env bash
# tests/lib/test-helpers.sh — shared test utilities for wiki-skills test suite
# Compatible: macOS bash 3.2 + Linux bash 4+
# Usage: source "$(dirname "$0")/../../lib/test-helpers.sh"

# ---------------------------------------------------------------------------
# Counters (use arithmetic expansion — bash 3.2 safe, avoids ((COUNTER++)))
# ---------------------------------------------------------------------------
TESTS_PASSED=0
TESTS_FAILED=0

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

# assert_equals EXPECTED ACTUAL MESSAGE
assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "FAIL: $message"
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# assert_contains SUBSTRING STRING MESSAGE
assert_contains() {
  local substring="$1"
  local string="$2"
  local message="$3"
  if echo "$string" | grep -qF "$substring"; then
    echo "PASS: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "FAIL: $message"
    echo "  Expected to contain: $substring"
    echo "  Actual: $string"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# assert_file_exists PATH MESSAGE
assert_file_exists() {
  local path="$1"
  local message="$2"
  if [ -f "$path" ]; then
    echo "PASS: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "FAIL: $message"
    echo "  File not found: $path"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# assert_exit_zero COMMAND MESSAGE
assert_exit_zero() {
  local message="$2"
  if eval "$1" >/dev/null 2>&1; then
    echo "PASS: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "FAIL: $message"
    echo "  Command failed: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# assert_exit_nonzero COMMAND MESSAGE
assert_exit_nonzero() {
  local message="$2"
  if ! eval "$1" >/dev/null 2>&1; then
    echo "PASS: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "FAIL: $message"
    echo "  Command should have failed: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# make_temp_vault — copy sample-vault to a temp dir, print path
# Usage: tmpvault=$(make_temp_vault)
make_temp_vault() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local fixture_src="$script_dir/../fixtures/sample-vault"
  local tmpdir
  tmpdir=$(mktemp -d)
  cp -r "$fixture_src/." "$tmpdir/"
  echo "$tmpdir"
}

# ---------------------------------------------------------------------------
# Summary printer
# ---------------------------------------------------------------------------

# print_summary — call at end of each test file
print_summary() {
  local skill="${1:-unknown}"
  echo ""
  echo "========================================"
  echo "[$skill] Tests Passed: $TESTS_PASSED"
  echo "[$skill] Tests Failed: $TESTS_FAILED"
  echo "========================================"
  [ "$TESTS_FAILED" -eq 0 ]
}
