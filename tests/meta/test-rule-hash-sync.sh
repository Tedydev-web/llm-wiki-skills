#!/usr/bin/env bash
# tests/meta/test-rule-hash-sync.sh — L3 meta-test: verify all shim RULE_HASHes match SKILL.md
# Compatible: macOS bash 3.2 + Linux bash 4+
# Usage: bash tests/meta/test-rule-hash-sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0
PASS=0
CHECKED=0

# sha256 helper — portable macOS + Linux
_sha256_lines() {
  local file="$1"
  local start="$2"
  local end="$3"
  if command -v sha256sum >/dev/null 2>&1; then
    sed -n "${start},${end}p" "$file" | sha256sum | awk '{print $1}'
  else
    sed -n "${start},${end}p" "$file" | shasum -a 256 | awk '{print $1}'
  fi
}

echo "=== L3: Rule Hash Sync ==="
echo "Scanning shims in $PROJECT_ROOT/tests/integration/..."
echo ""

for shim_dir in "$PROJECT_ROOT/tests/integration"/*/shim; do
  [ -d "$shim_dir" ] || continue
  for shim in "$shim_dir"/*.sh; do
    [ -f "$shim" ] || continue

    # Skip shims with no RULE_SOURCE (they have no hash to verify)
    if ! grep -q '^# RULE_SOURCE:' "$shim" 2>/dev/null; then
      continue
    fi

    CHECKED=$((CHECKED + 1))
    shim_name="$(basename "$shim")"

    src="$(grep '^# RULE_SOURCE:' "$shim" | head -1 | sed 's/^# RULE_SOURCE: //')"
    expected="$(grep '^# RULE_HASH:' "$shim" | head -1 | awk '{print $3}')"

    if [ -z "$src" ] || [ -z "$expected" ]; then
      echo "FAIL: $shim_name — RULE_SOURCE or RULE_HASH comment missing"
      echo "      Add both comments. See tests/CONTRIBUTING.md for format."
      FAIL=$((FAIL + 1))
      continue
    fi

    file="${src%:*}"
    range="${src##*:}"
    start="${range%-*}"
    end="${range#*-}"

    abs_file="$PROJECT_ROOT/$file"
    if [ ! -f "$abs_file" ]; then
      echo "FAIL: $shim_name — RULE_SOURCE file not found: $abs_file"
      echo "      Update RULE_SOURCE pointer if file was moved."
      FAIL=$((FAIL + 1))
      continue
    fi

    actual="$(_sha256_lines "$abs_file" "$start" "$end")"

    if [ "$expected" = "$actual" ]; then
      echo "PASS: $shim_name — hash matches ($file:$range)"
      PASS=$((PASS + 1))
    else
      echo "FAIL: $shim_name — RULE_HASH mismatch"
      echo "      Source:   $file:$range"
      echo "      Expected: $expected"
      echo "      Actual:   $actual"
      echo "      SKILL.md has changed. Review prose, update shim logic if needed, then:"
      echo "        bash tests/lib/regenerate-rule-hashes.sh"
      FAIL=$((FAIL + 1))
    fi
  done
done

echo ""
echo "========================================"
echo "L3 Rule Hash Sync: $PASS passed, $FAIL failed ($CHECKED shims checked)"
echo "========================================"

if [ "$CHECKED" -eq 0 ]; then
  echo "INFO: No shims with RULE_SOURCE found — nothing to verify."
fi

[ "$FAIL" -eq 0 ]
