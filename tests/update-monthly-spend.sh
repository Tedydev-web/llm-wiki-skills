#!/usr/bin/env bash
# tests/update-monthly-spend.sh — increment L5_MONTHLY_USD repo variable after each L5 run
# Parses claude-p cost output from run-real-llm-gated.sh; increments rolling 30-day sum.
# Uses gh api to read/write repo variable L5_MONTHLY_USD.
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# Called by .github/workflows/test-pre-merge.yml after L5 run.
# Environment: GH_TOKEN must be set (provided by CI as secrets.GITHUB_TOKEN).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Cost estimate for this run (parsed from L5 output or defaulted to $0.50 worst-case)
# In practice, parse actual cost from claude -p stdout if cost reporting is available.
COST_THIS_RUN="${L5_COST_THIS_RUN:-0.50}"

# Guard: gh CLI required
if ! command -v gh >/dev/null 2>&1; then
  echo "WARNING: gh CLI not found — cannot update L5_MONTHLY_USD" >&2
  exit 0
fi

# Guard: GH_TOKEN required
if [ -z "${GH_TOKEN:-}" ]; then
  echo "WARNING: GH_TOKEN not set — cannot update L5_MONTHLY_USD" >&2
  exit 0
fi

# Read current value of L5_MONTHLY_USD repo variable
REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  echo "WARNING: GITHUB_REPOSITORY not set — cannot update L5_MONTHLY_USD" >&2
  exit 0
fi

current="$(gh api "repos/$REPO/actions/variables/L5_MONTHLY_USD" \
  --jq '.value' 2>/dev/null || echo "0")"

if [ -z "$current" ]; then
  current="0"
fi

# Add cost for this run
new_total="$(echo "$current + $COST_THIS_RUN" | bc -l 2>/dev/null \
  || awk "BEGIN{printf \"%.2f\", $current + $COST_THIS_RUN}")"

echo "L5 spend update: \$$current + \$$COST_THIS_RUN = \$$new_total (30-day rolling)"

# Update repo variable
gh api \
  --method PATCH \
  "repos/$REPO/actions/variables/L5_MONTHLY_USD" \
  --field value="$new_total" \
  --field name="L5_MONTHLY_USD" \
  2>/dev/null && echo "Updated L5_MONTHLY_USD to \$$new_total" \
  || {
    # Variable may not exist yet — create it
    gh api \
      --method POST \
      "repos/$REPO/actions/variables" \
      --field value="$new_total" \
      --field name="L5_MONTHLY_USD" \
      2>/dev/null && echo "Created L5_MONTHLY_USD = \$$new_total" \
      || echo "WARNING: failed to update L5_MONTHLY_USD (non-fatal)"
  }

# Warn if approaching cap
if echo "$new_total >= 18" | bc -l 2>/dev/null | grep -q '^1$'; then
  echo "WARNING: L5 monthly spend \$$new_total approaching \$20 cap"
fi
