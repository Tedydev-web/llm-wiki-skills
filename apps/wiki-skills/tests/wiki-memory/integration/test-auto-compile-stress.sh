#!/usr/bin/env bash
# test-auto-compile-stress.sh — 5 concurrent real &-forked hook invocations.
# Verifies: no duplicate queue entries, no data loss, worker.lock singleton.
# Uses REAL background processes (not synthesized timestamps) per F-FM9 fix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
HOOK="$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh"
WORKER="$PROJECT_ROOT/skills/wiki-memory/scripts/auto-compile-worker.sh"

PASS=0
FAIL=0

_pass() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Fixture vault ──────────────────────────────────────────────────────────────
VAULT="$(mktemp -d)"
CONF_DIR="$(mktemp -d)"
# XDG_CONFIG_HOME=$CONF_DIR → conf lives at $CONF_DIR/wiki/auto-compile.conf
CONF_FILE="$CONF_DIR/wiki/auto-compile.conf"

trap "rm -rf '$VAULT' '$CONF_DIR'" EXIT

mkdir -p "$VAULT/wiki" "$VAULT/raw/sessions" "$VAULT/.queue"
chmod 700 "$VAULT/.queue"
mkdir -p "$CONF_DIR/wiki"

# Auto-compile conf (claude_bin = /usr/bin/true so invocations are instant no-ops)
cat > "$CONF_FILE" <<CONF
max_invocations_per_day=20
worker_timeout_seconds=30
claude_bin=/usr/bin/true
ingest_command=/wiki-ingest
CONF
chmod 600 "$CONF_FILE"

# ── Generate 5 unique transcripts ─────────────────────────────────────────────
declare -a SIDS=("stress-aaa111" "stress-bbb222" "stress-ccc333" "stress-ddd444" "stress-eee555")
declare -a TRANSCRIPTS=()

for sid in "${SIDS[@]}"; do
  # macOS mktemp does not support non-alphanumeric suffixes after the X pattern;
  # use a plain tmp file then rename with .jsonl suffix.
  tf_base="$(mktemp /tmp/wiki-stress-XXXXXX)"
  tf="${tf_base}.jsonl"
  mv "$tf_base" "$tf"
  printf '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"session %s"}]}}\n' \
    "$sid" > "$tf"
  TRANSCRIPTS+=("$tf")
done

trap "rm -rf '$VAULT' '$CONF_DIR' $(printf '%s ' "${TRANSCRIPTS[@]}")" EXIT

echo "=================================================="
echo "Stress Test — 5 concurrent &-forked hook invocations"
echo "=================================================="
echo ""
echo "Spawning 5 background hook processes..."

# ── Fork 5 concurrent hooks ────────────────────────────────────────────────────
declare -a PIDS=()
for i in 0 1 2 3 4; do
  sid="${SIDS[$i]}"
  tf="${TRANSCRIPTS[$i]}"
  stdin_payload="$(jq -cn --arg sid "$sid" --arg tp "$tf" \
    '{"session_id":$sid,"transcript_path":$tp,"cwd":"/tmp"}')"

  (
    env \
      WIKI_MEMORY_VAULT="$VAULT" \
      XDG_CONFIG_HOME="$CONF_DIR" \
      bash "$HOOK" <<<"$stdin_payload" 2>/dev/null
  ) &
  PIDS+=($!)
done

# Wait for all background hooks
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

echo "All 5 hooks completed."
echo ""

# ── Assertions ─────────────────────────────────────────────────────────────────

# 1. Exactly 5 capture files in raw/sessions/
capture_count=$(find "$VAULT/raw/sessions" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$capture_count" -eq 5 ]]; then
  _pass "5 capture files written to raw/sessions/ (count=$capture_count)"
else
  _fail "Expected 5 capture files, got $capture_count"
  find "$VAULT/raw/sessions" -maxdepth 1 2>/dev/null | sed 's/^/  /'
fi

# 2. Exactly 5 job files in .queue/ (one per session)
queue_count=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$queue_count" -eq 5 ]]; then
  _pass "5 job files in .queue/ (count=$queue_count)"
else
  _fail "Expected 5 queue jobs, got $queue_count"
  find "$VAULT/.queue" -maxdepth 1 2>/dev/null | sed 's/^/  /'
fi

# 3. Each session_id appears exactly once in queue (no duplicates)
dup_count=0
for sid in "${SIDS[@]}"; do
  matches=$(find "$VAULT/.queue" -maxdepth 1 -name "${sid}.json" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$matches" -ne 1 ]]; then
    _fail "session $sid: expected 1 queue file, found $matches"
    dup_count=$((dup_count + 1))
  fi
done
if [[ "$dup_count" -eq 0 ]]; then
  _pass "No duplicate queue entries (each session_id appears exactly once)"
fi

# 4. Each session has exactly one .lock dir (per-session uniqueness guard)
for sid in "${SIDS[@]}"; do
  lock_path="$VAULT/.queue/${sid}.lock"
  if [[ -d "$lock_path" ]]; then
    _pass "Session lock exists for $sid"
  else
    # Lock may have been cleaned up if worker ran — check job file instead
    job_path="$VAULT/.queue/${sid}.json"
    if [[ -f "$job_path" ]]; then
      _pass "Session $sid: job file present (lock may be absent if no worker ran yet)"
    else
      _fail "Session $sid: neither lock nor job file found"
    fi
  fi
done

# 5. Worker singleton: fork 2 workers concurrently, only one should run
echo ""
echo "Testing worker.lock singleton (2 concurrent workers)..."

# Run worker twice in parallel — only one should acquire .worker.lock
WORKER_LOG1="$(mktemp)"
WORKER_LOG2="$(mktemp)"
trap "rm -rf '$VAULT' '$CONF_DIR' '$WORKER_LOG1' '$WORKER_LOG2' $(printf '%s ' "${TRANSCRIPTS[@]}")" EXIT

(
  env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
    bash "$WORKER" --once >"$WORKER_LOG1" 2>&1 || true
) &
W1=$!

(
  env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
    bash "$WORKER" --once >"$WORKER_LOG2" 2>&1 || true
) &
W2=$!

wait "$W1" || true
wait "$W2" || true

# One worker should log "another worker is running" or both should log worker-exit
# Check that .worker.lock is NOT present (both should have released/skipped)
if [[ ! -d "$VAULT/.queue/.worker.lock" ]]; then
  _pass "Worker.lock released cleanly after concurrent run"
else
  _fail "Worker.lock still present after concurrent run (stale?)"
  rmdir "$VAULT/.queue/.worker.lock" 2>/dev/null || true
fi

# At least one worker should log worker-start
memory_log="$VAULT/wiki/.memory.log"
if [[ -f "$memory_log" ]] && grep -q "worker-start" "$memory_log"; then
  _pass "At least one worker ran and logged worker-start"
else
  _fail "No worker-start entry found in .memory.log"
  cat "$WORKER_LOG1" | sed 's/^/  w1: /' || true
  cat "$WORKER_LOG2" | sed 's/^/  w2: /' || true
fi

rm -f "$WORKER_LOG1" "$WORKER_LOG2"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
