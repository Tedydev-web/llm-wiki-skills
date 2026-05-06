#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

echo "=========================================="
echo "Anti-trace Audit (RED-TEAM AT-1)"
echo "=========================================="
echo ""

# Extended pattern per plan.md §66 + ADR 001 + red-team M1 finding.
# Canonical test script (single source of truth — F14 paradox fix):
#   docs/ is excluded — ADRs reference forbidden tokens by definition (documented in plan.md §92).
#   fixtures/ excluded — fixture prose may legitimately describe bad patterns in quotes.
#   test-anti-trace* excluded — this file defines the patterns (circular self-reference).
#   *.golden.txt excluded — goldens may snapshot prose containing contextual references.
#
# If new contributor patterns emerge, extend PATTERNS here only (not in phase files).
# Scope: skills/ + tests/ (all subdirs except exclusions above).
PATTERNS="memory-compiler|coleam00|claude_agent_sdk|compile\.py|flush\.py|cole\b|CMC|spisak|second\.brain"

SCAN_PATHS=(
  "$PROJECT_ROOT/skills"
  "$PROJECT_ROOT/tests"
)

# grep options: -r recursive, -i case-insensitive, -E extended regex
# Exclude options must come before the pattern (POSIX requirement).
# *.md excluded: report/smoke files document forbidden tokens by reference (same rationale as docs/).
# *.golden.txt excluded: goldens may snapshot prose containing contextual references.
# test-anti-trace* excluded: this file defines the patterns (circular self-reference).
GREP_OPTS=(
  -r -i -E
  --exclude-dir=fixtures
  "--exclude=test-anti-trace*"
  "--exclude=*.golden.txt"
  "--exclude=*.md"
)

TOTAL_HITS=0
for scan_path in "${SCAN_PATHS[@]}"; do
  if [ ! -d "$scan_path" ]; then
    continue
  fi
  # grep exits 1 when no matches; pipe to wc -l still returns 0 — that's correct.
  # tr strips leading whitespace from macOS wc -l output.
  # Parenthesise the pipeline so || applies only to the whole group, not just grep.
  hits=$(( grep "${GREP_OPTS[@]}" "$PATTERNS" "$scan_path" 2>/dev/null || true ) | wc -l | tr -d ' \n')
  TOTAL_HITS=$((TOTAL_HITS + hits))
  echo "  Scan: $scan_path — hits: $hits"
done

echo ""

if [ "$TOTAL_HITS" -eq 0 ]; then
    echo "PASS: Clean anti-trace audit (skills/ + tests/ scanned)"
    exit 0
else
    echo "FAIL: Found $TOTAL_HITS forbidden references"
    echo ""
    echo "Matching lines:"
    for scan_path in "${SCAN_PATHS[@]}"; do
      [ -d "$scan_path" ] || continue
      ( grep "${GREP_OPTS[@]}" "$PATTERNS" "$scan_path" 2>/dev/null || true )
    done
    exit 1
fi
