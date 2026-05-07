#!/usr/bin/env bash
# test-anti-trace.sh — scan repo for forbidden trace tokens from brainstorm/ADR documents
# Ensures no internal architecture details (class names, constants, perms) leak into scaffold.
#
# Usage: bash tests/wiki-team/integration/test-anti-trace.sh
# Exit 0 = clean; Exit 1 = trace tokens found (prints locations)
#
# Compatible with bash 3.2+ (macOS default shell) — no mapfile/readarray used.
# P11 wires this into CI. P01 authors canonical version + runs initial 0-hit check.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_REL="tests/wiki-team/integration/test-anti-trace.sh"

# --------------------------------------------------------------------------
# Forbidden tokens (word-bounded, fixed-string grep)
# Class names
CLASS_NAMES=(
  ResolvedIdentity
  AssistantTurn
  ProviderRegistry
  ProgressTracker
  AgentState
  PolicyDecision
  ProviderType
  ScopeType
  WorkspaceRole
  MCPAuthService
  KnowledgeType
)

# Constants
CONSTANTS=(
  MAX_DOCUMENT_CHARS
  MAX_INDEX_PAGES_LISTED
  TOP_K_RELEVANT
  MAX_STEPS
  INITIAL_EXCERPT_CHARS
  WARN_STEPS
)

# Permission verbs (colon-delimited — use fixed-string, word boundary won't match colons)
PERMISSION_VERBS=(
  "doc:read:own_dept"
  "doc:read:all"
  "wiki:write:own_dept"
  "org:departments:manage"
  "workspace:view:all"
)

# Functions
FUNCTIONS=(
  apply_scope_filter
  build_document_filter
  regenerate_index
  compile_source_into_wiki
  compile_source_with_agent
  extract_wikilinks
  refresh_links
)

# Snake-case identifiers (v2.1 additions — arkon attr/method names forbidden in scaffold)
SNAKE_NAMES=(
  vision_caption
  provider_registry
)

# Brand tokens
BRAND=(
  arkon
  nduckmink
  Sahara
)

# --------------------------------------------------------------------------
# Build exclusion prune args for find
EXCLUDES=(
  -path "${REPO_ROOT}/tests/fixtures" -prune -o
  -path "${REPO_ROOT}/tests/wiki-team/integration/test-anti-trace.sh" -prune -o
  -path "${REPO_ROOT}/docs/decisions/009-*" -prune -o
  -path "${REPO_ROOT}/docs/decisions/README.md" -prune -o
  -path "${REPO_ROOT}/apps/wiki-skills" -prune -o
  -path "${REPO_ROOT}/plans" -prune -o
  -path "${REPO_ROOT}/node_modules" -prune -o
  -path "${REPO_ROOT}/.git" -prune -o
  -path "${REPO_ROOT}/.docker" -prune -o
  -path "${REPO_ROOT}/LICENSE-NOTICE.md" -prune -o
  -path "${REPO_ROOT}/CHANGELOG.md" -prune -o
  -path "${REPO_ROOT}/README.md" -prune -o
  -path "${REPO_ROOT}/docs/journals" -prune -o
)

# Build a temp file listing all scannable paths (bash 3.2 compatible, no mapfile)
SCAN_LIST="$(mktemp)"
trap 'rm -f "${SCAN_LIST}"' EXIT

find "${REPO_ROOT}" \
  "${EXCLUDES[@]}" \
  -type f -print \
  | grep -v '/node_modules/' \
  | grep -v '/\.git/' \
  | grep -v '/plans/' \
  | grep -v '/apps/wiki-skills/' \
  | sort > "${SCAN_LIST}"

# --------------------------------------------------------------------------
# Combine all forbidden tokens into one array
ALL_TOKENS=(
  "${CLASS_NAMES[@]}"
  "${CONSTANTS[@]}"
  "${FUNCTIONS[@]}"
  "${SNAKE_NAMES[@]}"
  "${BRAND[@]}"
)

HITS=0
HIT_OUTPUT=""

# Scan word-bounded tokens: grep -wF ensures whole-word fixed-string match
# Note: -f /dev/null was removed — it overrides the positional pattern arg, causing vacuous pass.
# -r and --include='*' were removed — we pass explicit file list from SCAN_LIST.
for token in "${ALL_TOKENS[@]}"; do
  result="$(grep -wnF -- "${token}" $(cat "${SCAN_LIST}") 2>/dev/null || true)"
  if [[ -n "${result}" ]]; then
    HITS=$(( HITS + $(echo "${result}" | wc -l | tr -d ' ') ))
    HIT_OUTPUT="${HIT_OUTPUT}"$'\n'"  [word] ${result}"
  fi
done

# Scan permission verbs (fixed-string only — colons aren't word chars so -w won't match)
for perm in "${PERMISSION_VERBS[@]}"; do
  result="$(grep -nF -- "${perm}" $(cat "${SCAN_LIST}") 2>/dev/null || true)"
  if [[ -n "${result}" ]]; then
    HITS=$(( HITS + $(echo "${result}" | wc -l | tr -d ' ') ))
    HIT_OUTPUT="${HIT_OUTPUT}"$'\n'"  [perm] ${result}"
  fi
done

# --------------------------------------------------------------------------
# Report
if [[ ${HITS} -eq 0 ]]; then
  echo "anti-trace: PASS — 0 forbidden tokens found in scaffold"
  exit 0
else
  echo "anti-trace: FAIL — ${HITS} forbidden token hit(s) found:"
  echo "${HIT_OUTPUT}"
  exit 1
fi
