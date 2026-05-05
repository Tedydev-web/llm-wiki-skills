#!/usr/bin/env bash
# test-auto-compile-counter-corruption.sh — F6: pre-corrupt counter, verify
# worker exits with loud error, does NOT silently reset to 0, queue retained.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
WORKER="$PROJECT_ROOT/skills/wiki-memory/scripts/auto-compile-worker.sh"

PASS=0
FAIL=0

_pass() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Fixtures ──────────────────────────────────────────────────────────────────
VAULT="$(mktemp -d)"
CONF_DIR="$(mktemp -d)"
# XDG_CONFIG_HOME=$CONF_DIR → files live at $CONF_DIR/wiki/
mkdir -p "$CONF_DIR/wiki"
CONF_FILE="$CONF_DIR/wiki/auto-compile.conf"
STATE_FILE="$CONF_DIR/wiki/cost-cap.state"

trap "rm -rf '$VAULT' '$CONF_DIR'" EXIT

mkdir -p "$VAULT/wiki" "$VAULT/raw/sessions" "$VAULT/.queue"
chmod 700 "$VAULT/.queue"

cat > "$CONF_FILE" <<CONF
max_invocations_per_day=10
worker_timeout_seconds=30
claude_bin=/usr/bin/true
ingest_command=/wiki-ingest
CONF
chmod 600 "$CONF_FILE"

# Plant a job in the queue (1 session)
JOB_FILE="$VAULT/.queue/abc123.json"
jq -n '{"session_id":"abc123","capture_path":"/tmp/fake.md","enqueued_at":"2026-05-05T00:00:00Z"}' \
  > "$JOB_FILE"
chmod 600 "$JOB_FILE"

echo "=================================================="
echo "Counter Corruption Test (F6)"
echo "=================================================="

# ── Case 1: truncated / empty counter file ────────────────────────────────────
echo ""
echo "Case 1: empty/truncated counter file"
printf '' > "$STATE_FILE"
chmod 600 "$STATE_FILE"

WORKER_STDERR="$(mktemp)"
env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$WORKER" --once 2>"$WORKER_STDERR" >/dev/null || true

# Queue must still be present (not silently drained on corrupt counter)
if [[ -f "$JOB_FILE" ]]; then
  _pass "Case 1: queue file retained after corrupt empty counter"
else
  _fail "Case 1: queue file was removed despite corrupt counter (silent bypass!)"
fi

# Counter must NOT have been silently reset to 0 with count=0 → no write
# (an empty file is corrupt; the worker should refuse, not reset)
if grep -qi "corrupt\|error\|unreadable" "$WORKER_STDERR" 2>/dev/null || \
   grep -qi "corrupt\|error\|unreadable" "$VAULT/wiki/.memory.log" 2>/dev/null; then
  _pass "Case 1: loud error logged for corrupt counter"
else
  _fail "Case 1: no error logged for corrupt counter"
  echo "  stderr: $(cat "$WORKER_STDERR")"
fi
rm -f "$WORKER_STDERR"
# Remove .cost-cap-hit sibling so Cases 2+ reach cost_check and get the error
rm -f "${JOB_FILE%.json}.cost-cap-hit" 2>/dev/null || true

# ── Case 2: malformed JSON counter ────────────────────────────────────────────
echo ""
echo "Case 2: malformed JSON in counter"
printf 'NOT_JSON_AT_ALL\n' > "$STATE_FILE"
chmod 600 "$STATE_FILE"

WORKER_STDERR="$(mktemp)"
env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$WORKER" --once 2>"$WORKER_STDERR" >/dev/null || true

if [[ -f "$JOB_FILE" ]]; then
  _pass "Case 2: queue file retained after malformed JSON counter"
else
  _fail "Case 2: queue file removed despite malformed JSON (silent bypass!)"
fi

if grep -qi "corrupt\|error\|unreadable" "$WORKER_STDERR" 2>/dev/null || \
   grep -qi "corrupt\|error\|unreadable" "$VAULT/wiki/.memory.log" 2>/dev/null; then
  _pass "Case 2: loud error logged for malformed JSON counter"
else
  _fail "Case 2: no error logged for malformed JSON counter"
  echo "  stderr: $(cat "$WORKER_STDERR")"
fi
rm -f "$WORKER_STDERR"
# Remove .cost-cap-hit sibling so Case 3 reaches cost_check
rm -f "${JOB_FILE%.json}.cost-cap-hit" 2>/dev/null || true

# ── Case 3: non-numeric count field ───────────────────────────────────────────
echo ""
echo "Case 3: non-numeric count field"
printf '{"date":"2026-05-05","count":"BADVALUE"}\n' > "$STATE_FILE"
chmod 600 "$STATE_FILE"

WORKER_STDERR="$(mktemp)"
env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$WORKER" --once 2>"$WORKER_STDERR" >/dev/null || true

if [[ -f "$JOB_FILE" ]]; then
  _pass "Case 3: queue file retained after non-numeric count"
else
  _fail "Case 3: queue file removed despite non-numeric count (silent bypass!)"
fi

if grep -qi "corrupt\|error\|non-numeric" "$WORKER_STDERR" 2>/dev/null || \
   grep -qi "corrupt\|error\|non-numeric" "$VAULT/wiki/.memory.log" 2>/dev/null; then
  _pass "Case 3: loud error logged for non-numeric count"
else
  _fail "Case 3: no error logged for non-numeric count"
  echo "  stderr: $(cat "$WORKER_STDERR")"
fi
rm -f "$WORKER_STDERR"

# ── Case 4: counter with valid format but at-cap — verify refuses gracefully ──
echo ""
echo "Case 4: valid counter already at max — job should be orphaned not dropped"
TODAY="$(date -u +%Y-%m-%d)"
printf '{"date":"%s","count":10}\n' "$TODAY" > "$STATE_FILE"
chmod 600 "$STATE_FILE"

env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$WORKER" --once 2>/dev/null >/dev/null || true

# Job file must still exist (orphaned with .cost-cap-hit sibling, not removed)
if [[ -f "$JOB_FILE" ]]; then
  _pass "Case 4: job file retained when at-cap (will retry tomorrow)"
else
  _fail "Case 4: job file removed when at-cap (data loss!)"
fi

# .cost-cap-hit sibling should be written
if [[ -f "${JOB_FILE%.json}.cost-cap-hit" ]]; then
  _pass "Case 4: .cost-cap-hit sibling written"
else
  # Some implementations log to .memory.log instead — check there
  if grep -q "cost-cap-hit\|cap-orphan" "$VAULT/wiki/.memory.log" 2>/dev/null; then
    _pass "Case 4: cap-hit logged in .memory.log"
  else
    _fail "Case 4: no .cost-cap-hit sibling and no log entry"
  fi
fi

# ── Verify counter was NOT silently zeroed across all cases ───────────────────
echo ""
echo "Counter integrity check: state file should not be auto-reset to 0"
if [[ -f "$STATE_FILE" ]]; then
  final_count="$(jq -r '.count // empty' "$STATE_FILE" 2>/dev/null)" || final_count=""
  if [[ "$final_count" == "0" ]]; then
    # Count=0 is only valid after an explicit cost_reset — not after corruption
    # Check: the state written should be today's at-cap value (10), not 0
    final_date="$(jq -r '.date // empty' "$STATE_FILE" 2>/dev/null)" || final_date=""
    if [[ "$final_date" == "$TODAY" && "$final_count" == "0" ]]; then
      _fail "Counter integrity: counter silently reset to 0 (cap bypass)"
    else
      _pass "Counter integrity: count not zero after corruption cases"
    fi
  else
    _pass "Counter integrity: count is '$final_count' (not silently zeroed)"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
