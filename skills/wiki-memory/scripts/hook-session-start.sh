#!/usr/bin/env bash
[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0
# hook-session-start.sh — SessionStart lifecycle hook for wiki-memory
# Injects knowledge base context into Claude Code at session start.
# Reads <vault>/wiki/cache.md + last 30 lines of <vault>/wiki/log.md,
# truncates combined content to 20K chars, emits hookSpecificOutput JSON.
# Skips injection when source == "compact" (PreCompact already ran this
# lifecycle; injecting again would double-inject context — red-team F-2/V8).
# Reads stdin JSON: {"session_id":"...","source":"startup|resume|compact","cwd":"..."}

(
  # Recursion guard: skip if invoked by another wiki-memory process
  [[ -n "${WIKI_MEMORY_INVOKED_BY:-}" ]] && exit 0

  # ── Parse stdin ────────────────────────────────────────────────────────────
  stdin_json="$(cat)"
  source_field="$(jq -r '.source // empty' <<<"$stdin_json" 2>/dev/null)"
  session_cwd="$(jq -r '.cwd // empty' <<<"$stdin_json" 2>/dev/null)"

  # Skip injection when session was triggered by compaction (double-context guard)
  if [[ "$source_field" == "compact" ]]; then
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
    # No vault configured — emit empty output (no context to inject)
    exit 0
  fi

  # ── Read knowledge base index (cache.md) ───────────────────────────────────
  cache_content=""
  cache_path="${vault}/wiki/cache.md"
  if [[ -f "$cache_path" ]]; then
    cache_content="$(cat "$cache_path" 2>/dev/null)"
  fi

  # ── Read recent activity (last 30 lines of log.md) ────────────────────────
  log_content=""
  log_path="${vault}/wiki/log.md"
  if [[ -f "$log_path" ]]; then
    log_content="$(tail -n 30 "$log_path" 2>/dev/null)"
  fi

  # If both sources are empty, nothing to inject
  if [[ -z "$cache_content" && -z "$log_content" ]]; then
    exit 0
  fi

  # ── Build combined context with section headings ───────────────────────────
  combined=""
  if [[ -n "$cache_content" ]]; then
    combined="## Knowledge Base Index

${cache_content}"
  fi

  if [[ -n "$log_content" ]]; then
    if [[ -n "$combined" ]]; then
      combined="${combined}

## Recent Activity

${log_content}"
    else
      combined="## Recent Activity

${log_content}"
    fi
  fi

  # ── Truncate to 20K chars at last newline boundary ────────────────────────
  MAX_CONTEXT_CHARS=20000
  if (( ${#combined} > MAX_CONTEXT_CHARS )); then
    # Truncate raw bytes, then trim back to the last complete line
    truncated="$(printf '%s' "$combined" | head -c "$MAX_CONTEXT_CHARS")"
    # Drop any partial last line (trim to last newline)
    combined="${truncated%$'\n'*}"
    # If no newline found at all (single very long line), use truncated as-is
    if [[ "$combined" == "$truncated" ]]; then
      combined="$truncated"
    fi
  fi

  # ── Emit hookSpecificOutput JSON ───────────────────────────────────────────
  jq -nc --arg ctx "$combined" \
    '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'

) || true
exit 0
