#!/usr/bin/env bash
# tests/lib/regenerate-rule-hashes.sh — recompute all RULE_HASH lines in shims
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# Usage (manual invocation after intentional SKILL.md edit):
#   bash tests/lib/regenerate-rule-hashes.sh
#   bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-04.sh
#
# After running: review diffs with `git diff`, then commit both SKILL.md + shim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source the rule-hash library functions directly (avoid re-running case block)
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

_recompute_shim() {
  local shim="$1"
  if [ ! -f "$shim" ]; then
    echo "ERROR: shim not found: $shim" >&2
    return 1
  fi

  local src
  src="$(grep '^# RULE_SOURCE:' "$shim" | head -1 | sed 's/^# RULE_SOURCE: //')" || true
  if [ -z "$src" ]; then
    echo "SKIP (no RULE_SOURCE): $shim"
    return 0
  fi

  local file="${src%:*}"
  local range="${src##*:}"
  local start="${range%-*}"
  local end="${range#*-}"

  # Resolve relative path from project root
  local abs_file="$PROJECT_ROOT/$file"
  if [ ! -f "$abs_file" ]; then
    echo "ERROR: RULE_SOURCE file not found: $abs_file" >&2
    echo "       (referenced from $shim)" >&2
    return 1
  fi

  local new_hash
  new_hash="$(_sha256_lines "$abs_file" "$start" "$end")"

  # Replace RULE_HASH line in-place (portable sed)
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "s|^# RULE_HASH:.*|# RULE_HASH: ${new_hash}|" "$shim"
  else
    sed -i '' "s|^# RULE_HASH:.*|# RULE_HASH: ${new_hash}|" "$shim"
  fi

  echo "UPDATED: $(basename "$shim")  ->  $new_hash"
}

# If specific shim(s) passed as arguments, process only those
if [ "$#" -gt 0 ]; then
  for shim in "$@"; do
    _recompute_shim "$shim"
  done
  exit 0
fi

# Otherwise process all shims in integration directories
UPDATED=0
SKIPPED=0
ERRORS=0

echo "Scanning shims in $PROJECT_ROOT/tests/integration/..."
echo ""

for shim_dir in "$PROJECT_ROOT/tests/integration"/*/shim; do
  if [ ! -d "$shim_dir" ]; then
    continue
  fi
  for shim in "$shim_dir"/*.sh; do
    if [ ! -f "$shim" ]; then
      continue
    fi
    if grep -q '^# RULE_SOURCE:' "$shim" 2>/dev/null; then
      if _recompute_shim "$shim"; then
        UPDATED=$((UPDATED + 1))
      else
        ERRORS=$((ERRORS + 1))
      fi
    else
      echo "SKIP (no RULE_SOURCE): $(basename "$shim")"
      SKIPPED=$((SKIPPED + 1))
    fi
  done
done

echo ""
echo "========================================"
echo "Regeneration complete"
echo "  Updated: $UPDATED"
echo "  Skipped: $SKIPPED"
echo "  Errors:  $ERRORS"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff tests/integration/"
echo "  2. Verify tests pass: bash tests/meta/test-rule-hash-sync.sh"
echo "  3. Commit: git add tests/integration/ skills/ && git commit"

[ "$ERRORS" -eq 0 ]
