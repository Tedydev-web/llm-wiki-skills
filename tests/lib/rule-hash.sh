#!/usr/bin/env bash
# tests/lib/rule-hash.sh — L3 hash lockfile helpers
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# Commands:
#   compute  FILE START END       — print sha256 of lines START-END in FILE
#   verify   SHIM_FILE            — verify shim's RULE_HASH matches SKILL.md source
#   recompute SHIM_FILE           — recompute and update RULE_HASH in shim in-place
#
# Usage from shim meta-test:
#   source tests/lib/rule-hash.sh
#   verify_rule_hash "tests/integration/wiki-lint/shim/step-04.sh"

# NOTE: set -euo pipefail is intentionally NOT at top level — this file is designed
# to be sourced by test scripts. The strict-mode block is inside the BASH_SOURCE guard
# at the bottom so it only applies when this file runs as a CLI command.

# _sha256_lines FILE START END — compute sha256 of lines START to END (inclusive)
_sha256_lines() {
  local file="$1"
  local start="$2"
  local end="$3"
  # sed line range; shasum -a 256 for macOS + sha256sum for Linux
  if command -v sha256sum >/dev/null 2>&1; then
    sed -n "${start},${end}p" "$file" | sha256sum | awk '{print $1}'
  else
    sed -n "${start},${end}p" "$file" | shasum -a 256 | awk '{print $1}'
  fi
}

# compute_rule_hash FILE START END — print sha256
compute_rule_hash() {
  local file="$1"
  local start="$2"
  local end="$3"
  if [ ! -f "$file" ]; then
    echo "ERROR: file not found: $file" >&2
    return 1
  fi
  _sha256_lines "$file" "$start" "$end"
}

# verify_rule_hash SHIM_FILE — returns 0 if hash matches, 1 if mismatch
# Reads RULE_SOURCE and RULE_HASH comment lines from the shim.
verify_rule_hash() {
  local shim="$1"
  if [ ! -f "$shim" ]; then
    echo "ERROR: shim not found: $shim" >&2
    return 1
  fi

  local src
  src="$(grep '^# RULE_SOURCE:' "$shim" | head -1 | sed 's/^# RULE_SOURCE: //')"
  local expected_hash
  expected_hash="$(grep '^# RULE_HASH:' "$shim" | head -1 | awk '{print $3}')"

  if [ -z "$src" ] || [ -z "$expected_hash" ]; then
    echo "ERROR: $shim missing RULE_SOURCE or RULE_HASH comment" >&2
    return 1
  fi

  # Parse "path:START-END" format
  local file="${src%:*}"
  local range="${src##*:}"
  local start="${range%-*}"
  local end="${range#*-}"

  if [ ! -f "$file" ]; then
    echo "ERROR: RULE_SOURCE file not found: $file" >&2
    echo "       (referenced from $shim)" >&2
    return 1
  fi

  local actual_hash
  actual_hash="$(_sha256_lines "$file" "$start" "$end")"

  if [ "$expected_hash" = "$actual_hash" ]; then
    return 0
  else
    echo "FAIL: RULE_HASH mismatch in $shim"
    echo "  RULE_SOURCE: $src"
    echo "  Expected:    $expected_hash"
    echo "  Actual:      $actual_hash"
    echo ""
    echo "  The cited SKILL.md lines have changed."
    echo "  Review the change, update the shim logic if needed, then regenerate:"
    echo "    bash tests/lib/regenerate-rule-hashes.sh"
    return 1
  fi
}

# _recompute_shim SHIM_FILE — recompute RULE_HASH and update in-place
_recompute_shim() {
  local shim="$1"
  if [ ! -f "$shim" ]; then
    echo "ERROR: shim not found: $shim" >&2
    return 1
  fi

  local src
  src="$(grep '^# RULE_SOURCE:' "$shim" | head -1 | sed 's/^# RULE_SOURCE: //')"
  if [ -z "$src" ]; then
    echo "SKIP: $shim has no RULE_SOURCE" >&2
    return 0
  fi

  local file="${src%:*}"
  local range="${src##*:}"
  local start="${range%-*}"
  local end="${range#*-}"

  if [ ! -f "$file" ]; then
    echo "ERROR: RULE_SOURCE file not found: $file" >&2
    return 1
  fi

  local new_hash
  new_hash="$(_sha256_lines "$file" "$start" "$end")"

  # Replace RULE_HASH line in-place (sed -i portable form)
  if sed --version 2>/dev/null | grep -q GNU; then
    # GNU sed
    sed -i "s|^# RULE_HASH:.*|# RULE_HASH: ${new_hash}|" "$shim"
  else
    # BSD sed (macOS)
    sed -i '' "s|^# RULE_HASH:.*|# RULE_HASH: ${new_hash}|" "$shim"
  fi

  echo "UPDATED: $shim  RULE_HASH -> $new_hash"
}

# CLI entrypoint — only executes when this file is run directly, not when sourced.
# When sourced (BASH_SOURCE[0] != $0), the set -euo pipefail and CLI block are skipped
# so that sourcing callers don't inherit -e and don't trigger CLI dispatch.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  case "${1:-}" in
    compute)
      compute_rule_hash "${2:?file}" "${3:?start}" "${4:?end}"
      ;;
    verify)
      verify_rule_hash "${2:?shim_file}"
      ;;
    recompute)
      _recompute_shim "${2:?shim_file}"
      ;;
    *)
      echo "Usage: $0 <compute FILE START END | verify SHIM | recompute SHIM>" >&2
      exit 1
      ;;
  esac
fi
