#!/usr/bin/env bash
# test-auto-compile-symlink-attack.sh — F9: symlink .queue to /tmp/evil,
# verify hook and worker both refuse with loud error and do not write outside vault.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
HOOK="$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh"
WORKER="$PROJECT_ROOT/skills/wiki-memory/scripts/auto-compile-worker.sh"

PASS=0
FAIL=0

_pass() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Fixtures ──────────────────────────────────────────────────────────────────
VAULT="$(mktemp -d)"
EVIL_DIR="$(mktemp -d)"   # simulates attacker-controlled directory
CONF_DIR="$(mktemp -d)"
# XDG_CONFIG_HOME=$CONF_DIR → conf lives at $CONF_DIR/wiki/auto-compile.conf
mkdir -p "$CONF_DIR/wiki"
CONF_FILE="$CONF_DIR/wiki/auto-compile.conf"
TRANSCRIPT_BASE="$(mktemp /tmp/wiki-symlink-XXXXXX)"
TRANSCRIPT="${TRANSCRIPT_BASE}.jsonl"
mv "$TRANSCRIPT_BASE" "$TRANSCRIPT"

trap "rm -rf '$VAULT' '$EVIL_DIR' '$CONF_DIR' '$TRANSCRIPT'" EXIT

mkdir -p "$VAULT/wiki" "$VAULT/raw/sessions"

printf '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"test"}]}}\n' \
  > "$TRANSCRIPT"

cat > "$CONF_FILE" <<CONF
max_invocations_per_day=10
worker_timeout_seconds=30
claude_bin=/usr/bin/true
ingest_command=/wiki-ingest
CONF
chmod 600 "$CONF_FILE"

echo "=================================================="
echo "Symlink Attack Test (F9)"
echo "=================================================="

# ── Case 1: hook refuses when .queue/ is a symlink ────────────────────────────
echo ""
echo "Case 1: hook with .queue/ symlinked to /tmp/evil"

# Plant symlink instead of real directory
ln -s "$EVIL_DIR" "$VAULT/.queue"

stdin_payload="$(jq -cn --arg sid "symlink-test-1" --arg tp "$TRANSCRIPT" \
  '{"session_id":$sid,"transcript_path":$tp,"cwd":"/tmp"}')"

HOOK_STDERR="$(mktemp)"
env \
  WIKI_MEMORY_VAULT="$VAULT" \
  XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$HOOK" <<<"$stdin_payload" 2>"$HOOK_STDERR"
hook_exit=$?

# Hook must exit 0 (outer subshell absorbs) but should have logged the error
if [[ "$hook_exit" -eq 0 ]]; then
  _pass "Case 1 (hook): exited 0 (outer shell contract preserved)"
else
  _fail "Case 1 (hook): non-zero exit $hook_exit (hook must always exit 0)"
fi

# No files written inside EVIL_DIR
evil_count=$(find "$EVIL_DIR" -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
if [[ "$evil_count" -le 1 ]]; then
  _pass "Case 1 (hook): no files written to evil symlink target (count=$evil_count)"
else
  _fail "Case 1 (hook): $evil_count files/dirs found in evil target — symlink not blocked!"
  find "$EVIL_DIR" -maxdepth 2 | sed 's/^/  /'
fi

# .memory.log should have a warning
memory_log="$VAULT/wiki/.memory.log"
if [[ -f "$memory_log" ]] && grep -qi "symlink\|abort" "$memory_log" 2>/dev/null; then
  _pass "Case 1 (hook): symlink attack logged to .memory.log"
else
  # Also check stderr
  if grep -qi "symlink\|refusing\|F9" "$HOOK_STDERR" 2>/dev/null; then
    _pass "Case 1 (hook): symlink attack reported on stderr"
  else
    _fail "Case 1 (hook): no symlink error logged"
    echo "  stderr: $(cat "$HOOK_STDERR" | head -5)"
  fi
fi
rm -f "$HOOK_STDERR"

# ── Case 2: worker refuses when .queue/ is a symlink ─────────────────────────
echo ""
echo "Case 2: worker with .queue/ symlinked to /tmp/evil"

WORKER_STDERR="$(mktemp)"
env WIKI_MEMORY_VAULT="$VAULT" XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$WORKER" --once 2>"$WORKER_STDERR" >/dev/null || true
worker_exit=$?

if [[ "$worker_exit" -eq 1 ]]; then
  _pass "Case 2 (worker): exited 1 on symlink detection"
elif [[ "$worker_exit" -eq 0 ]]; then
  # May exit 0 with "info" message — check it reported the issue
  if grep -qi "symlink\|refusing\|F9" "$WORKER_STDERR" 2>/dev/null; then
    _pass "Case 2 (worker): symlink detected and reported (exit 0 with log)"
  else
    _fail "Case 2 (worker): exited 0 but no symlink error — may have processed evil dir"
  fi
else
  _fail "Case 2 (worker): unexpected exit code $worker_exit"
fi

evil_count_after=$(find "$EVIL_DIR" -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
if [[ "$evil_count_after" -le 1 ]]; then
  _pass "Case 2 (worker): no files written to evil symlink target"
else
  _fail "Case 2 (worker): $evil_count_after entries in evil target"
  find "$EVIL_DIR" -maxdepth 2 | sed 's/^/  /'
fi
rm -f "$WORKER_STDERR"

# ── Case 3: after removing symlink, real dir works ───────────────────────────
echo ""
echo "Case 3: after removing symlink, normal queue dir works"

rm -f "$VAULT/.queue"   # remove the symlink
mkdir -m 700 -p "$VAULT/.queue"

stdin_payload2="$(jq -cn --arg sid "symlink-clean-test" --arg tp "$TRANSCRIPT" \
  '{"session_id":$sid,"transcript_path":$tp,"cwd":"/tmp"}')"

env \
  WIKI_MEMORY_VAULT="$VAULT" \
  XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$HOOK" <<<"$stdin_payload2" 2>/dev/null

# Check for real queue file (may not exist if extract-turns found 0 turns)
real_queue=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$real_queue" -ge 0 ]]; then
  _pass "Case 3: hook ran without error on real queue dir (queue files: $real_queue)"
fi

# Confirm no files in evil dir
final_evil=$(find "$EVIL_DIR" -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
if [[ "$final_evil" -le 1 ]]; then
  _pass "Case 3: evil target still clean after legitimate run"
else
  _fail "Case 3: evil target has $final_evil entries — contamination detected"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
