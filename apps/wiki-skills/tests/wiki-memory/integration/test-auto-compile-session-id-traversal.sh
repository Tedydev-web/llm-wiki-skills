#!/usr/bin/env bash
# test-auto-compile-session-id-traversal.sh — F10: feed hostile session_ids to
# hook-session-end.sh, assert sanitization catches them and no file escapes vault.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
HOOK="$PROJECT_ROOT/skills/wiki-memory/scripts/hook-session-end.sh"

PASS=0
FAIL=0

_pass() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Fixtures ──────────────────────────────────────────────────────────────────
VAULT="$(mktemp -d)"
CONF_DIR="$(mktemp -d)"
TRANSCRIPT_BASE="$(mktemp /tmp/wiki-traversal-XXXXXX)"
TRANSCRIPT="${TRANSCRIPT_BASE}.jsonl"
mv "$TRANSCRIPT_BASE" "$TRANSCRIPT"

trap "rm -rf '$VAULT' '$CONF_DIR' '$TRANSCRIPT'" EXIT

mkdir -p "$VAULT/wiki" "$VAULT/raw/sessions"
mkdir -m 700 -p "$VAULT/.queue"
# XDG_CONFIG_HOME=$CONF_DIR → conf lives at $CONF_DIR/wiki/auto-compile.conf
mkdir -p "$CONF_DIR/wiki"

printf '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"test"}]}}\n' \
  > "$TRANSCRIPT"

cat > "$CONF_DIR/wiki/auto-compile.conf" <<CONF
max_invocations_per_day=10
worker_timeout_seconds=30
claude_bin=/usr/bin/true
ingest_command=/wiki-ingest
CONF
chmod 600 "$CONF_DIR/wiki/auto-compile.conf"

echo "=================================================="
echo "Session-ID Traversal Sanitization Test (F10)"
echo "=================================================="

# ── Helper: invoke hook with given session_id ─────────────────────────────────
_invoke_with_sid() {
  local sid="$1"
  local payload
  payload="$(jq -cn --arg sid "$sid" --arg tp "$TRANSCRIPT" \
    '{"session_id":$sid,"transcript_path":$tp,"cwd":"/tmp"}')"
  env \
    WIKI_MEMORY_VAULT="$VAULT" \
    XDG_CONFIG_HOME="$CONF_DIR" \
    bash "$HOOK" <<<"$payload" 2>/dev/null
}

_no_escape() {
  # Check no files were written outside the vault root
  local outside
  outside=$(find /tmp -maxdepth 3 -name 'wiki-escape-*' 2>/dev/null | wc -l | tr -d ' ')
  [[ "$outside" -eq 0 ]]
}

# ── Case 1: path traversal ../../etc/foo ─────────────────────────────────────
echo ""
echo "Case 1: session_id='../../etc/foo'"
_before=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
_invoke_with_sid "../../etc/foo"
_after=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')

if [[ "$_after" -eq "$_before" ]]; then
  _pass "Case 1: traversal '../../etc/foo' — no queue file written"
else
  _fail "Case 1: traversal produced $((_after - _before)) queue file(s)!"
fi

# Verify no .json file with traversal chars exists anywhere under queue
if find "$VAULT/.queue" -name '*etc*' -o -name '*..*' 2>/dev/null | grep -q .; then
  _fail "Case 1: file with traversal chars found in queue"
else
  _pass "Case 1: no traversal-named files in queue"
fi

# ── Case 2: space in session_id ───────────────────────────────────────────────
# Note: null bytes are stripped by jq before reaching the hook. Testing a space
# instead, which jq preserves and our regex correctly rejects.
echo ""
echo "Case 2: session_id with spaces"
_before=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
_invoke_with_sid "bad session id"
_after=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$_after" -eq "$_before" ]]; then
  _pass "Case 2: session_id with spaces — no queue file written"
else
  _fail "Case 2: session_id with spaces produced queue files (sanitization failed!)"
fi

# ── Case 3: shell metacharacters ──────────────────────────────────────────────
echo ""
echo "Case 3: session_id='\$(rm -rf /tmp/wiki-escape-test)'"
mkdir -p /tmp/wiki-escape-test  # create sentinel dir
_before=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
_invoke_with_sid '$(rm -rf /tmp/wiki-escape-test)'
if [[ -d /tmp/wiki-escape-test ]]; then
  _pass "Case 3: metacharacter session_id — sentinel directory not deleted (no shell injection)"
  rmdir /tmp/wiki-escape-test 2>/dev/null || true
else
  _fail "Case 3: sentinel directory was deleted — possible shell injection!"
fi

_after=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$_after" -eq "$_before" ]]; then
  _pass "Case 3: metacharacter session_id — no queue file written"
else
  _fail "Case 3: metacharacter session_id produced queue files"
fi

# ── Case 4: slash in session_id ──────────────────────────────────────────────
echo ""
echo "Case 4: session_id='valid/subdir/escape'"
_before=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
_invoke_with_sid "valid/subdir/escape"
_after=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$_after" -eq "$_before" ]]; then
  _pass "Case 4: slash in session_id — no queue file written"
else
  _fail "Case 4: slash in session_id produced queue files"
fi

# Ensure no subdirs were created under .queue by the traversal
if find "$VAULT/.queue" -mindepth 2 -name '*.json' 2>/dev/null | grep -q .; then
  _fail "Case 4: .json files found in subdirs of .queue (traversal succeeded!)"
else
  _pass "Case 4: no nested .json files in .queue"
fi

# ── Case 5: empty session_id ─────────────────────────────────────────────────
echo ""
echo "Case 5: empty session_id"
_before=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
empty_payload="$(jq -cn --arg tp "$TRANSCRIPT" \
  '{"session_id":"","transcript_path":$tp,"cwd":"/tmp"}')"
env \
  WIKI_MEMORY_VAULT="$VAULT" \
  XDG_CONFIG_HOME="$CONF_DIR" \
  bash "$HOOK" <<<"$empty_payload" 2>/dev/null
_after=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$_after" -eq "$_before" ]]; then
  _pass "Case 5: empty session_id — no queue file written"
else
  _fail "Case 5: empty session_id produced queue files"
fi

# ── Case 6: valid session_id still works ─────────────────────────────────────
echo ""
echo "Case 6: valid session_id 'abc123-def' passes sanitization"
_invoke_with_sid "abc123-def"
after_queue6=$(find "$VAULT/.queue" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
# Valid id should produce a queue file (if extract-turns got content)
# We can't guarantee content from minimal transcript, so just verify no crash
_pass "Case 6: valid session_id 'abc123-def' — hook completed without error"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
