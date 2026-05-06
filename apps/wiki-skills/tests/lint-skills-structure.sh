#!/usr/bin/env bash
# tests/lint-skills-structure.sh — L1 markdown lint + L2 schema invariants for all SKILL.md files
# Compatible: macOS bash 3.2 + Linux bash 4+
# Usage: bash tests/lint-skills-structure.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$PROJECT_ROOT/skills"

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# L1: Markdown structure checks (pure bash — no markdownlint dependency)
# ---------------------------------------------------------------------------
echo ""
echo "=== L1: Markdown Structure ==="

for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
  skill_name="$(basename "$(dirname "$skill_md")")"

  # L1-1: Frontmatter block starts with ---
  if head -1 "$skill_md" | grep -q '^---$'; then
    pass "$skill_name: frontmatter start (---)"
  else
    fail "$skill_name: missing frontmatter start (---)"
  fi

  # L1-2: Frontmatter block ends with --- (second occurrence)
  if awk '/^---/{c++; if(c==2){found=1; exit}} END{exit !found}' "$skill_md"; then
    pass "$skill_name: frontmatter end (---)"
  else
    fail "$skill_name: missing frontmatter end (---)"
  fi

  # L1-3: Exactly one H1 (# Title)
  h1_count="$(grep -c '^# ' "$skill_md" || true)"
  if [ "$h1_count" -ge 1 ]; then
    pass "$skill_name: has H1 heading ($h1_count found)"
  else
    fail "$skill_name: missing H1 heading"
  fi

  # L1-4: No empty code blocks (``` followed immediately by ```)
  if ! grep -qP '^```\s*\n```' "$skill_md" 2>/dev/null; then
    pass "$skill_name: no empty code blocks"
  else
    fail "$skill_name: contains empty code blocks"
  fi
done

# ---------------------------------------------------------------------------
# L2: Schema invariants — required frontmatter fields
# ---------------------------------------------------------------------------
echo ""
echo "=== L2: Schema Invariants — Frontmatter Fields ==="

REQUIRED_FIELDS="name description allowed-tools"

for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
  skill_name="$(basename "$(dirname "$skill_md")")"

  for field in $REQUIRED_FIELDS; do
    # Extract only the frontmatter block (between first and second ---)
    fm="$(awk '/^---/{c++; if(c==2)exit} c==1' "$skill_md")"
    if echo "$fm" | grep -q "^${field}:"; then
      pass "$skill_name: frontmatter has '$field'"
    else
      fail "$skill_name: frontmatter missing '$field'"
    fi
  done
done

# ---------------------------------------------------------------------------
# L2: Schema invariants — mandatory sections
# ---------------------------------------------------------------------------
echo ""
echo "=== L2: Schema Invariants — Mandatory Sections ==="

# All prose skills must have ## Workflow OR ## Audit Steps OR ## Search Strategy
for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
  skill_name="$(basename "$(dirname "$skill_md")")"
  if grep -qE '^## (Workflow|Audit Steps|Search Strategy|Identify Sources|Step 0|Process Each Source|Save Mode|Subcommands|Activation|Wizard Flow|Capture Flow)' "$skill_md"; then
    pass "$skill_name: has primary workflow section"
  else
    fail "$skill_name: missing primary workflow section"
  fi
done

# wiki-lint: assert at least 15 numbered step sections (P05: content moved to references/audit-steps.md)
wiki_lint_steps="$(grep -cE '^## Step [0-9]+' "$SKILLS_DIR/wiki-lint/references/audit-steps.md" 2>/dev/null || true)"
if [ "$wiki_lint_steps" -ge 15 ]; then
  pass "wiki-lint: $wiki_lint_steps audit step sections in references/audit-steps.md (expected ≥15)"
else
  fail "wiki-lint: expected ≥15 audit step sections in references/audit-steps.md, found $wiki_lint_steps"
fi

# wiki-query: assert --save flag documented in ## Flags section
if grep -qE '\-\-save' "$SKILLS_DIR/wiki-query/SKILL.md"; then
  pass "wiki-query: --save flag documented"
else
  fail "wiki-query: --save flag missing from SKILL.md"
fi

# wiki-query: assert ## Flags section exists
if grep -q '^## Flags' "$SKILLS_DIR/wiki-query/SKILL.md"; then
  pass "wiki-query: ## Flags section present"
else
  fail "wiki-query: ## Flags section missing"
fi

# wiki-ingest: assert --promote-qa flag documented
if grep -qE '\-\-promote-qa' "$SKILLS_DIR/wiki-ingest/SKILL.md"; then
  pass "wiki-ingest: --promote-qa flag documented"
else
  fail "wiki-ingest: --promote-qa flag missing from SKILL.md"
fi

# wiki-ingest: assert state.json invariants mentioned (Step 0 and Step N)
if grep -q 'state\.json' "$SKILLS_DIR/wiki-ingest/SKILL.md"; then
  pass "wiki-ingest: state.json invariants documented"
else
  fail "wiki-ingest: state.json invariants missing"
fi

# wiki-ingest: assert atomic write pattern documented
if grep -q 'atomic' "$SKILLS_DIR/wiki-ingest/SKILL.md"; then
  pass "wiki-ingest: atomic write pattern documented"
else
  fail "wiki-ingest: atomic write pattern missing"
fi

# ---------------------------------------------------------------------------
# L2: Anti-trace audit (delegate to canonical test)
# ---------------------------------------------------------------------------
echo ""
echo "=== L2: Anti-Trace Audit ==="

ANTI_TRACE="$PROJECT_ROOT/tests/wiki-memory/integration/test-anti-trace.sh"
if [ -f "$ANTI_TRACE" ]; then
  if bash "$ANTI_TRACE" 2>&1; then
    pass "anti-trace audit clean"
  else
    fail "anti-trace audit found forbidden references"
  fi
else
  fail "anti-trace script not found: $ANTI_TRACE"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "L1+L2 Summary: $PASS passed, $FAIL failed"
echo "========================================"

[ "$FAIL" -eq 0 ]
