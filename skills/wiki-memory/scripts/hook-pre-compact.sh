#!/usr/bin/env bash
[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0
# hook-pre-compact.sh — PreCompact lifecycle hook for wiki-memory
# Snapshots mid-session transcript before Claude Code context compaction.
# CRITICAL: This hook MUST exit 0 in all cases — a non-zero exit BLOCKS
# compaction and breaks the user's session (Claude Code spec requirement).
# Minimum 5 turns required before snapshot is written (MIN_TURNS gate).
# Reads stdin JSON: {"session_id":"...","transcript_path":"...","cwd":"..."}

(
  # Recursion guard: skip if invoked by another wiki-memory process
  [[ -n "${WIKI_MEMORY_INVOKED_BY:-}" ]] && exit 0

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  MIN_TURNS=5

  # ── Parse stdin ────────────────────────────────────────────────────────────
  stdin_json="$(cat)"
  session_id="$(jq -r '.session_id // empty' <<<"$stdin_json" 2>/dev/null)"
  transcript_path="$(jq -r '.transcript_path // empty' <<<"$stdin_json" 2>/dev/null)"
  session_cwd="$(jq -r '.cwd // empty' <<<"$stdin_json" 2>/dev/null)"

  if [[ -z "$session_id" ]]; then
    echo "[wiki-memory:pre-compact] SKIP: missing session_id in stdin" >&2
    exit 0
  fi

  # ── Resolve vault path (3-tier lookup) ─────────────────────────────────────
  vault=""
  if [[ -n "${WIKI_MEMORY_VAULT:-}" ]]; then
    vault="$WIKI_MEMORY_VAULT"
  elif [[ -f "$HOME/.config/wiki-memory/vault-path" ]]; then
    vault="$(cat "$HOME/.config/wiki-memory/vault-path" | tr -d '[:space:]')"
  elif [[ -n "$session_cwd" && -f "${session_cwd}/.claude/wiki-memory.conf" ]]; then
    vault="$(grep -m1 '^vault=' "${session_cwd}/.claude/wiki-memory.conf" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')"
  fi

  if [[ -z "$vault" ]]; then
    echo "[wiki-memory:pre-compact] SKIP: vault not configured" >&2
    exit 0
  fi

  # ── Validate transcript path ───────────────────────────────────────────────
  if [[ -z "$transcript_path" ]]; then
    echo "[wiki-memory:pre-compact] SKIP: missing transcript_path in stdin" >&2
    exit 0
  fi

  if [[ ! -f "$transcript_path" ]]; then
    echo "[wiki-memory:pre-compact] SKIP: transcript not found: $transcript_path" >&2
    exit 0
  fi

  # ── MIN_TURNS gate: count parseable user/assistant turns ──────────────────
  turn_count="$(jq -r 'select(.message.role // empty | . == "user" or . == "assistant") | .message.role' \
    "$transcript_path" 2>/dev/null | wc -l | tr -d '[:space:]')"

  if (( turn_count < MIN_TURNS )); then
    echo "[wiki-memory:pre-compact] SKIP: only ${turn_count} turns (min ${MIN_TURNS})" >&2
    exit 0
  fi

  # ── Extract turns ──────────────────────────────────────────────────────────
  max_chars="${WIKI_MEMORY_MAX_CHARS:-15000}"
  tmp_file="$(mktemp /tmp/wiki-memory-compact-XXXXXX.md)"

  bash "${SCRIPT_DIR}/extract-turns.sh" "$transcript_path" 30 "$max_chars" > "$tmp_file" 2>/dev/null

  if [[ ! -s "$tmp_file" ]]; then
    rm -f "$tmp_file"
    echo "[wiki-memory:pre-compact] SKIP: no turns extracted from transcript" >&2
    exit 0
  fi

  # ── Generate target filename ───────────────────────────────────────────────
  safe_id="$(printf '%s' "$session_id" | tr -cd 'a-zA-Z0-9-' | head -c 8)"
  filename="pre-compact-$(date +%Y-%m-%d-%H%M)-${safe_id}.md"
  sessions_dir="${vault}/raw/sessions"
  target_path="${sessions_dir}/${filename}"

  mkdir -p "$sessions_dir"

  # Avoid clobbering if a pre-compact was already written this minute
  if [[ -f "$target_path" ]]; then
    target_path="${sessions_dir}/pre-compact-$(date +%Y-%m-%d-%H%M%S)-${safe_id}.md"
  fi

  mv "$tmp_file" "$target_path"

  # ── Append to .memory.log via mkdir-lock ───────────────────────────────────
  log_dir="${vault}/wiki"
  mkdir -p "$log_dir"
  lock_dir="${log_dir}/.memory.log.lock"
  log_file="${log_dir}/.memory.log"
  iso_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  acquired=false
  for _i in $(seq 1 10); do
    if mkdir "$lock_dir" 2>/dev/null; then
      acquired=true
      break
    fi
    sleep 0.2
  done

  if [[ "$acquired" == "true" ]]; then
    printf '%s pre-compact %s -> %s\n' "$iso_ts" "$session_id" "$filename" >> "$log_file"
    rmdir "$lock_dir" 2>/dev/null || true
  else
    echo "[wiki-memory:pre-compact] WARN: could not acquire log lock; skipping log entry" >&2
  fi

) || true
exit 0
