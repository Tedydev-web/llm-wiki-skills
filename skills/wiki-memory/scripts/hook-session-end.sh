#!/usr/bin/env bash
[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0
# hook-session-end.sh — SessionEnd lifecycle hook for wiki-memory
# Captures completed session transcript into <vault>/raw/sessions/
# Reads stdin JSON: {"session_id":"...","transcript_path":"...","cwd":"..."}
# Never exits non-zero — wraps body in subshell to absorb all failures.
#
# Auto-compile extension (P04):
#   When auto-compile native is enabled (conf file present), enqueues a job
#   in <vault>/.queue/ instead of (in addition to) the existing capture logic.
#   3-layer recursion guard prevents re-entry from worker's claude -p invocations.

(
  umask 077

  # ── Layer 1 recursion guard: env-var set by worker ─────────────────────────
  # Spike confirmed (2026-05-05): WIKI_MEMORY_INVOKED_BY propagates through
  # claude -p → SessionEnd hook. Exit 0 immediately — no enqueue, no capture.
  [[ -n "${WIKI_MEMORY_INVOKED_BY:-}" ]] && exit 0

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

  # shellcheck source=lib-vault-discovery.sh
  source "$SCRIPT_DIR/lib-vault-discovery.sh"
  # shellcheck source=lib-fs-safety.sh
  source "$SCRIPT_DIR/lib-fs-safety.sh"

  # ── Parse stdin ─────────────────────────────────────────────────────────────
  stdin_json="$(cat)"
  session_id="$(jq -r '.session_id // empty' <<<"$stdin_json" 2>/dev/null)"
  transcript_path="$(jq -r '.transcript_path // empty' <<<"$stdin_json" 2>/dev/null)"
  session_cwd="$(jq -r '.cwd // empty' <<<"$stdin_json" 2>/dev/null)"

  if [[ -z "$session_id" ]]; then
    echo "[wiki-memory:session-end] SKIP: missing session_id in stdin" >&2
    exit 0
  fi

  # ── F10: session_id sanitization ────────────────────────────────────────────
  # Must happen before any path construction using session_id.
  if ! sanitize_session_id "$session_id"; then
    # Silent exit per spec — bad session_id is not a user-visible error
    exit 0
  fi

  # ── Resolve vault path via 5-step lib ───────────────────────────────────────
  vault=""
  if [[ -n "$session_cwd" ]]; then
    vault="$(cd "$session_cwd" 2>/dev/null && discover_vault 2>/dev/null || true)"
  else
    vault="$(discover_vault 2>/dev/null || true)"
  fi

  if [[ -z "$vault" ]]; then
    echo "[wiki-memory:session-end] SKIP: vault not configured" >&2
    exit 0
  fi

  QUEUE_DIR="$vault/.queue"
  CONF_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/auto-compile.conf"
  auto_compile_enabled=false
  [[ -f "$CONF_FILE" ]] && auto_compile_enabled=true

  # ── F9: symlink check on .queue/ ────────────────────────────────────────────
  if [[ "$auto_compile_enabled" == true ]]; then
    if [[ -e "$QUEUE_DIR" ]]; then
      if ! check_no_symlink "$QUEUE_DIR" ".queue/"; then
        # Log to .memory.log and exit 1 (inside subshell — outer exit 0 preserved)
        log_file="$vault/wiki/.memory.log"
        mkdir -p "$vault/wiki"
        printf '%s session-end-abort reason=symlink-attack path=%s\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$QUEUE_DIR" >> "$log_file" 2>/dev/null || true
        exit 1
      fi
    fi
  fi

  # ── Layer 3 recursion guard: per-session mkdir lock ──────────────────────────
  # Prevents two concurrent hook fires for the same session_id from both writing.
  # (Layer 2 = verified env-var inheritance via spike — no separate mechanism needed.)
  sid_lock=""
  if [[ "$auto_compile_enabled" == true ]]; then
    # C2/F9: second guard — refuse if .queue is a symlink before mkdir (defense at every entry)
    if [[ -L "$QUEUE_DIR" ]]; then
      log_file="$vault/wiki/.memory.log"
      mkdir -p "$vault/wiki" 2>/dev/null || true
      printf '%s session-end-abort reason=symlink-at-mkdir path=%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$QUEUE_DIR" >> "$log_file" 2>/dev/null || true
      exit 1
    fi
    mkdir -p "$QUEUE_DIR" 2>/dev/null || true
    chmod 700 "$QUEUE_DIR" 2>/dev/null || true

    sid_lock="$QUEUE_DIR/${session_id}.lock"
    if ! mkdir -m 700 "$sid_lock" 2>/dev/null; then
      echo "[wiki-memory:session-end] SKIP: session lock exists (duplicate fire) session_id=$session_id" >&2
      exit 0
    fi
    # Lock acquired — will be cleaned up by worker on successful ingest
    # (intentionally NOT cleaned up here so worker can detect in-progress sessions)
  fi

  # ── Validate transcript path ─────────────────────────────────────────────────
  if [[ -z "$transcript_path" ]]; then
    echo "[wiki-memory:session-end] SKIP: missing transcript_path in stdin" >&2
    exit 0
  fi

  if [[ ! -f "$transcript_path" ]]; then
    echo "[wiki-memory:session-end] SKIP: transcript not found: $transcript_path" >&2
    exit 0
  fi

  # ── Extract turns ────────────────────────────────────────────────────────────
  max_chars="${WIKI_MEMORY_MAX_CHARS:-15000}"
  # Use PID + session_id prefix for uniqueness under concurrent execution.
  # macOS mktemp does not support non-X suffixes after the XXXXXX pattern,
  # so we create a plain temp file and rename it with a .md extension.
  _tmp_base="$(mktemp /tmp/wiki-mem-$$-XXXXXX)"
  tmp_file="${_tmp_base}.md"
  mv "$_tmp_base" "$tmp_file" 2>/dev/null || tmp_file="$_tmp_base"
  chmod 600 "$tmp_file" 2>/dev/null || true

  bash "${SCRIPT_DIR}/extract-turns.sh" "$transcript_path" 30 "$max_chars" > "$tmp_file" 2>/dev/null

  if [[ ! -s "$tmp_file" ]]; then
    rm -f "$tmp_file"
    echo "[wiki-memory:session-end] SKIP: no turns extracted from transcript" >&2
    exit 0
  fi

  # ── Generate target filename ─────────────────────────────────────────────────
  # Slugify session_id: already validated as ^[a-zA-Z0-9-]+$; take first 8 chars
  safe_id="$(printf '%s' "$session_id" | head -c 8)"
  filename="$(date +%Y-%m-%d-%H%M)-${safe_id}.md"
  sessions_dir="${vault}/raw/sessions"
  target_path="${sessions_dir}/${filename}"

  mkdir -p "$sessions_dir"

  # Avoid clobbering an existing file (append suffix if collision)
  if [[ -f "$target_path" ]]; then
    target_path="${sessions_dir}/$(date +%Y-%m-%d-%H%M%S)-${safe_id}.md"
  fi

  mv "$tmp_file" "$target_path"
  chmod 600 "$target_path" 2>/dev/null || true

  # ── Append to .memory.log via mkdir-lock ─────────────────────────────────────
  log_dir="${vault}/wiki"
  mkdir -p "$log_dir"
  lock_dir="${log_dir}/.memory.log.lock"
  log_file="${log_dir}/.memory.log"
  iso_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Spin-wait up to 2 seconds for lock (10 × 200ms)
  acquired=false
  for _i in $(seq 1 10); do
    if mkdir "$lock_dir" 2>/dev/null; then
      acquired=true
      break
    fi
    sleep 0.2
  done

  if [[ "$acquired" == "true" ]]; then
    printf '%s session-end %s -> %s\n' "$iso_ts" "$session_id" "$filename" >> "$log_file"
    rmdir "$lock_dir" 2>/dev/null || true
  else
    echo "[wiki-memory:session-end] WARN: could not acquire log lock; skipping log entry" >&2
  fi

  # ── Auto-compile enqueue (F11: always enqueue, no back-pressure refusal) ─────
  if [[ "$auto_compile_enabled" == true ]]; then
    job_file="$QUEUE_DIR/${session_id}.json"
    tmp_job="$QUEUE_DIR/${session_id}.json.tmp.$$"

    # Write job spec atomically (F8: mode 600)
    jq -n \
      --arg sid "$session_id" \
      --arg capture "$target_path" \
      --arg ts "$iso_ts" \
      '{"session_id":$sid,"capture_path":$capture,"enqueued_at":$ts}' \
      > "$tmp_job" 2>/dev/null || {
        echo "[wiki-memory:session-end] WARN: failed to write job spec for $session_id" >&2
        exit 0
    }
    chmod 600 "$tmp_job" 2>/dev/null || true
    mv "$tmp_job" "$job_file"

    printf '%s session-enqueued %s -> %s\n' "$iso_ts" "$session_id" "$job_file" >> "$log_file" 2>/dev/null || true
    echo "[wiki-memory:session-end] Enqueued job: $session_id" >&2
  fi

) || true
exit 0
