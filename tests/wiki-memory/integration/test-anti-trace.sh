#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

echo "=========================================="
echo "Anti-trace Audit (RED-TEAM AT-1)"
echo "=========================================="
echo ""

# Extended pattern per red-team AT-1 requirements
PATTERNS="memory-compiler|coleam00|claude_agent_sdk|compile\.py|flush\.py|cole\b|CMC"

HITS_CODE=$(grep -ri "$PATTERNS" "$PROJECT_ROOT/skills/wiki-memory" 2>/dev/null | grep -v "fixtures\|test-anti-trace" | wc -l || true)
HITS_TESTS=$(grep -ri "$PATTERNS" "$PROJECT_ROOT/tests/wiki-memory" 2>/dev/null | grep -v "fixtures\|test-anti-trace" | wc -l || true)

echo "Anti-trace Pattern Audit:"
echo "  Skills directory hits: $HITS_CODE"
echo "  Tests directory hits:  $HITS_TESTS"
echo ""

TOTAL_HITS=$((HITS_CODE + HITS_TESTS))

if [ "$TOTAL_HITS" -eq 0 ]; then
    echo "✓ PASS: Clean anti-trace audit"
    exit 0
else
    echo "✗ FAIL: Found $TOTAL_HITS forbidden references"
    exit 1
fi
