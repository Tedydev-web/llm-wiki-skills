#!/usr/bin/env bash
# extract-turns.sh — Shared lib: parse JSONL transcript → markdown user/assistant turns
# Usage: extract-turns.sh <transcript_path> <max_turns> <max_chars>
# Output: markdown to stdout; empty output on any failure (callers must check)
# Compatible with bash 3.2+ (macOS default shell).
#
# Supports Claude Code JSONL transcript format:
#   {"type":"message","message":{"role":"user"|"assistant","content":"..." or [...]}}
# Content may be a plain string or an array of content blocks [{type,text,...}].

set -uo pipefail

TRANSCRIPT_PATH="${1:-}"
MAX_TURNS="${2:-30}"
MAX_CHARS="${3:-15000}"

# Validate args
if [[ -z "$TRANSCRIPT_PATH" ]]; then
  echo "[extract-turns] ERROR: transcript_path required" >&2
  exit 1
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "[extract-turns] SKIP: transcript not found: $TRANSCRIPT_PATH" >&2
  exit 0
fi

# Build jq filter:
#   - Select lines where .message.role is "user" or "assistant"
#   - Extract content: if array → join text blocks; else use as string
#   - Emit "TURN:<role>:<text>" sentinel lines for bash parsing
JQ_FILTER='
  select(.message.role // empty | . == "user" or . == "assistant") |
  {
    role: .message.role,
    text: (
      if (.message.content | type) == "array" then
        [ .message.content[] | select(.type == "text") | .text // empty ] | join("\n")
      else
        .message.content // empty
      end
    )
  } |
  select(.text | length > 0) |
  "TURN:\(.role):\(.text)"
'

# Write extracted turns to a temp file (bash 3.2: no mapfile, use file + while)
# Use PID in name for concurrent safety; macOS mktemp rejects non-X extensions.
_turns_base="$(mktemp /tmp/wiki-turns-$$-XXXXXX)"
turns_file="${_turns_base}.txt"
mv "$_turns_base" "$turns_file" 2>/dev/null || turns_file="$_turns_base"
jq -rc "$JQ_FILTER" "$TRANSCRIPT_PATH" 2>/dev/null | tail -n "$MAX_TURNS" > "$turns_file"

# Count lines
turn_count=0
while IFS= read -r _line; do
  turn_count=$(( turn_count + 1 ))
done < "$turns_file"

if [[ "$turn_count" -eq 0 ]]; then
  rm -f "$turns_file"
  exit 0
fi

# Build output respecting max_chars budget
# Write to a second temp file so we can check size before emitting
# PID-prefixed for concurrent safety; macOS mktemp rejects non-X extensions.
_out_base="$(mktemp /tmp/wiki-output-$$-XXXXXX)"
output_file="${_out_base}.md"
mv "$_out_base" "$output_file" 2>/dev/null || output_file="$_out_base"
total_chars=0
first=true

while IFS= read -r raw; do
  # Parse "TURN:<role>:<text>" — role cannot contain colon, text may
  without_prefix="${raw#TURN:}"
  role="${without_prefix%%:*}"
  text="${without_prefix#${role}:}"

  if [[ "$role" == "user" ]]; then
    block="**User:** ${text}"
  elif [[ "$role" == "assistant" ]]; then
    block="**Assistant:** ${text}"
  else
    continue
  fi

  block_len=${#block}
  # +4 accounts for the "\n\n" separator between blocks
  separator_cost=0
  if [[ "$first" != "true" ]]; then
    separator_cost=2
  fi
  new_total=$(( total_chars + block_len + separator_cost ))

  if (( new_total > MAX_CHARS )); then
    # Truncate at last full turn boundary
    break
  fi

  if [[ "$first" == "true" ]]; then
    printf '%s' "$block" >> "$output_file"
    first=false
  else
    printf '\n\n%s' "$block" >> "$output_file"
  fi

  total_chars=$new_total
done < "$turns_file"

rm -f "$turns_file"

if [[ ! -s "$output_file" ]]; then
  rm -f "$output_file"
  exit 0
fi

# Emit to stdout and clean up
printf '\n' >> "$output_file"
cat "$output_file"
rm -f "$output_file"
