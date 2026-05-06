#!/usr/bin/env bash
# enable-hooks.sh — Register wiki-memory lifecycle hooks into settings.json
# Usage: enable-hooks.sh [--scope global|project] [--vault <path>] [--auto-compile native|manual]
# Default scope: global
# Idempotent: safe to run multiple times — produces exactly 3 hook entries.
#
# --auto-compile native:
#   Resolves claude_bin at enable-time (F7), checks fs-type (F15),
#   sets up ~/.config/wiki/auto-compile.conf (mode 600) + queue dir (mode 700),
#   and prints a platform-detected scheduler snippet for the user to install.
#
# --auto-compile manual (default):
#   Same as v1.1 behaviour — capture only, user runs /wiki-ingest manually.
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Verify we are running from within the skill tree
[[ -f "$SKILL_ROOT/SKILL.md" ]] || { echo "[wiki-memory] ERROR: SKILL.md not found — corrupted install?" >&2; exit 1; }

# Source shared helpers
# shellcheck source=lib-jq-merge.sh
source "$SCRIPT_DIR/lib-jq-merge.sh"
# shellcheck source=lib-vault-discovery.sh
source "$SCRIPT_DIR/lib-vault-discovery.sh"
# shellcheck source=lib-fs-safety.sh
source "$SCRIPT_DIR/lib-fs-safety.sh"

# ── Argument parsing ───────────────────────────────────────────────────────────
SCOPE="global"
VAULT_ARG=""
AUTO_COMPILE_MODE="manual"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      SCOPE="${2:?--scope requires a value: global|project}"
      shift 2
      ;;
    --vault)
      VAULT_ARG="${2:?--vault requires a path argument}"
      shift 2
      ;;
    --auto-compile)
      AUTO_COMPILE_MODE="${2:?--auto-compile requires a value: native|manual}"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--scope global|project] [--vault <path>] [--auto-compile native|manual]"
      echo ""
      echo "  --scope global          Register hooks in ~/.claude/settings.json (default)"
      echo "  --scope project         Register hooks in \$PWD/.claude/settings.json"
      echo "  --vault <path>          Path to your LLM Wiki vault (overrides WIKI_MEMORY_VAULT env)"
      echo "  --auto-compile native   Enable queue-based auto-ingest via cron/launchd"
      echo "  --auto-compile manual   Capture only; user runs /wiki-ingest manually (default)"
      exit 0
      ;;
    *)
      echo "[wiki-memory] ERROR: Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# Validate scope
case "$SCOPE" in
  global|project) ;;
  *)
    echo "[wiki-memory] ERROR: --scope must be 'global' or 'project', got: '$SCOPE'" >&2
    exit 1
    ;;
esac

# Validate auto-compile mode
case "$AUTO_COMPILE_MODE" in
  native|manual) ;;
  *)
    echo "[wiki-memory] ERROR: --auto-compile must be 'native' or 'manual', got: '$AUTO_COMPILE_MODE'" >&2
    exit 1
    ;;
esac

# ── Dependency check ───────────────────────────────────────────────────────────
require_jq

# ── Vault discovery ────────────────────────────────────────────────────────────
VAULT_PATH=""

if [[ -n "$VAULT_ARG" ]]; then
  VAULT_PATH="$VAULT_ARG"
else
  VAULT_PATH="$(discover_vault 2>/dev/null || true)"
  if [[ -z "$VAULT_PATH" ]]; then
    if [[ -t 0 ]]; then
      echo "[wiki-memory] Vault path not set. Enter the absolute path to your LLM Wiki vault:"
      read -r VAULT_PATH
    else
      echo "[wiki-memory] ERROR: Vault path not provided." >&2
      echo "  Use --vault <path> or set WIKI_MEMORY_VAULT env variable." >&2
      exit 1
    fi
  fi
fi

# Expand ~ in path (macOS bash 3.2 safe)
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"
VAULT_PATH="${VAULT_PATH%/}"

# ── Vault validation ───────────────────────────────────────────────────────────
if [[ ! -d "$VAULT_PATH" ]]; then
  echo "[wiki-memory] ERROR: Vault directory does not exist: $VAULT_PATH" >&2
  echo "  Run '/wiki' first to initialize your vault." >&2
  exit 1
fi

if [[ ! -d "$VAULT_PATH/wiki" ]]; then
  echo "[wiki-memory] ERROR: Vault is missing 'wiki/' directory: $VAULT_PATH" >&2
  echo "  Expected layout: $VAULT_PATH/wiki/  Run '/wiki' to initialize." >&2
  exit 1
fi

# ── Auto-compile native pre-flight checks ──────────────────────────────────────
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wiki"
CONF_FILE="$CONF_DIR/auto-compile.conf"
WORKER_SETTINGS_FILE="$CONF_DIR/worker-settings.json"

if [[ "$AUTO_COMPILE_MODE" == "native" ]]; then

  # F7: resolve claude binary at enable-time
  claude_bin=""
  if ! claude_bin="$(command -v claude 2>/dev/null)"; then
    echo "[wiki-memory] ERROR: 'claude' binary not found in PATH (F7)." >&2
    echo "  Auto-compile native requires the Claude CLI to be installed and on PATH." >&2
    echo "  Install it, then re-run this command." >&2
    exit 1
  fi
  echo "[wiki-memory] Found claude binary: $claude_bin"

  # F15: filesystem type check on vault path
  echo "[wiki-memory] Checking filesystem type for vault path..."
  if ! check_local_fs "$VAULT_PATH"; then
    echo "[wiki-memory] ERROR: auto-compile native is not supported on this filesystem." >&2
    exit 1
  fi
  echo "[wiki-memory] Filesystem check passed (local FS confirmed)."

  # F8: secure conf directory
  mkdir -p "$CONF_DIR"
  chmod 700 "$CONF_DIR" 2>/dev/null || true

  # F8: secure queue directory
  # C2/F9: refuse if .queue already exists as a symlink (defense at every entry point)
  QUEUE_DIR="$VAULT_PATH/.queue"
  if [[ -L "$QUEUE_DIR" ]]; then
    echo "[wiki-memory] ERROR: $QUEUE_DIR is a symbolic link; refusing to use (F9 hardening)" >&2
    exit 1
  fi
  mkdir -p "$QUEUE_DIR" 2>/dev/null || true
  chmod 700 "$QUEUE_DIR" 2>/dev/null || true

  # Prompt for max_invocations_per_day (default 10)
  max_invocations_per_day=10
  if [[ -t 0 ]]; then
    echo "[wiki-memory] Max auto-compile invocations per day (default: 10):"
    read -r _input_max
    if [[ -n "$_input_max" && "$_input_max" =~ ^[0-9]+$ ]]; then
      max_invocations_per_day="$_input_max"
    fi
  fi

  # Write auto-compile.conf atomically (F8: mode 600)
  _tmp_conf="${CONF_FILE}.tmp.$$"
  cat > "$_tmp_conf" <<CONF
# wiki-memory auto-compile configuration
# Written by enable-hooks.sh at $(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT edit claude_bin manually — re-run 'wiki-memory enable --auto-compile native' to update.
max_invocations_per_day=${max_invocations_per_day}
worker_timeout_seconds=300
claude_bin=${claude_bin}
ingest_command=/wiki-ingest
CONF
  chmod 600 "$_tmp_conf" 2>/dev/null || true
  mv "$_tmp_conf" "$CONF_FILE"
  echo "[wiki-memory] Auto-compile config written: $CONF_FILE"

  # Write worker-settings.json: minimal settings pointing at real hooks file
  # Worker needs this so the SessionEnd hook fires in claude -p sessions.
  # If global settings.json exists and has hooks, use that path; otherwise
  # write a minimal passthrough.
  _global_settings="$HOME/.claude/settings.json"
  _tmp_ws="${WORKER_SETTINGS_FILE}.tmp.$$"
  if [[ -f "$_global_settings" ]] && jq -e '.hooks' "$_global_settings" >/dev/null 2>&1; then
    # Extract the hooks section so worker inherits all registered hooks
    jq '{hooks: .hooks}' "$_global_settings" > "$_tmp_ws" 2>/dev/null || printf '{"hooks":{}}\n' > "$_tmp_ws"
  else
    printf '{"hooks":{}}\n' > "$_tmp_ws"
  fi
  chmod 600 "$_tmp_ws" 2>/dev/null || true
  mv "$_tmp_ws" "$WORKER_SETTINGS_FILE"
  echo "[wiki-memory] Worker settings written: $WORKER_SETTINGS_FILE"

fi  # end auto-compile native pre-flight

# ── Resolve settings.json target ───────────────────────────────────────────────
SETTINGS_PATH="$(resolve_settings_path "$SCOPE")"
SETTINGS_DIR="$(dirname "$SETTINGS_PATH")"
mkdir -p "$SETTINGS_DIR"

# ── Backup + lock ──────────────────────────────────────────────────────────────
BACKUP_PATH="$(backup_settings "$SETTINGS_PATH")"
acquire_lockdir "$SETTINGS_DIR"

# ── Register 3 lifecycle hooks ─────────────────────────────────────────────────
HOOKS_SCRIPT_DIR="$SCRIPT_DIR"

echo "[wiki-memory] Registering hooks in: $SETTINGS_PATH"

merge_hook_entry "$SETTINGS_PATH" "SessionStart" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-session-start.sh"

merge_hook_entry "$SETTINGS_PATH" "PreCompact" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-pre-compact.sh"

merge_hook_entry "$SETTINGS_PATH" "SessionEnd" \
  "bash ${HOOKS_SCRIPT_DIR}/hook-session-end.sh"

# ── Write vault sidecar config ─────────────────────────────────────────────────
if [[ "$SCOPE" == "global" ]]; then
  SIDECAR_FILE="$WIKI_NEW_SIDECAR"
  _sidecar_dir="${SIDECAR_FILE%/*}"

  if [[ -L "$_sidecar_dir" ]]; then
    echo "[wiki-memory] ERROR: sidecar directory is a symlink: $_sidecar_dir" >&2
    echo "  Remove the symlink and re-run to proceed." >&2
    exit 1
  fi

  mkdir -p "$_sidecar_dir"
  chmod 700 "$_sidecar_dir" 2>/dev/null || true

  if [[ -f "$SIDECAR_FILE" ]]; then
    _existing_vault="$(jq -r '.vault_path // empty' "$SIDECAR_FILE" 2>/dev/null || true)"
    if [[ -n "$_existing_vault" && "$_existing_vault" != "$VAULT_PATH" ]]; then
      if [[ -t 0 ]]; then
        echo "[wiki-memory] WARNING: sidecar already configured for vault: $_existing_vault"
        echo "  New vault: $VAULT_PATH"
        read -r -p "  Overwrite? [y/N]: " _confirm
        if [[ ! "$_confirm" =~ ^[Yy]$ ]]; then
          echo "[wiki-memory] Aborted — sidecar not updated." >&2
          exit 1
        fi
      else
        echo "[wiki-memory] ERROR: sidecar already configured for a different vault." >&2
        echo "  Existing: $_existing_vault" >&2
        echo "  Requested: $VAULT_PATH" >&2
        exit 1
      fi
    fi
  fi

  _tmp_sidecar="${SIDECAR_FILE}.tmp.$$"
  jq -n \
    --arg v "$VAULT_PATH" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{_schema_version: "1", _migration_date: $ts, vault_path: $v, compact_mode: "auto"}' \
    > "$_tmp_sidecar"
  chmod 600 "$_tmp_sidecar" 2>/dev/null || true
  mv "$_tmp_sidecar" "$SIDECAR_FILE"
else
  SIDECAR_DIR="$PWD/.claude"
  SIDECAR_FILE="$SIDECAR_DIR/wiki-memory.conf"
  mkdir -p "$SIDECAR_DIR"
  echo "vault-path=$VAULT_PATH" > "$SIDECAR_FILE"
fi

release_lockdir

# ── Ensure raw/sessions directory exists in vault ──────────────────────────────
mkdir -p "$VAULT_PATH/raw/sessions"

# ── Print platform-specific scheduler snippet (native mode only) ──────────────
if [[ "$AUTO_COMPILE_MODE" == "native" ]]; then
  echo ""
  echo "[wiki-memory] Auto-compile ENABLED (native mode)"
  echo "  Config:  $CONF_FILE"
  echo "  Queue:   $VAULT_PATH/.queue/"
  echo "  Max/day: $max_invocations_per_day"
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────────┐"
  echo "  │  SCHEDULER SETUP (one-time, copy-paste)                             │"
  echo "  └─────────────────────────────────────────────────────────────────────┘"
  echo ""

  _platform="$(uname -s 2>/dev/null || echo Linux)"
  _worker_path="${SCRIPT_DIR}/auto-compile-worker.sh"

  if [[ "$_platform" == "Darwin" ]]; then
    _plist_dir="$HOME/Library/LaunchAgents"
    _plist_file="$_plist_dir/com.wiki-memory.compile.plist"
    echo "  Platform detected: macOS — using launchd (recommended)"
    echo ""
    echo "  1. Create the LaunchAgent plist:"
    echo "     mkdir -p $_plist_dir"
    echo "     cat > $_plist_file << 'PLIST'"
    cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>         <string>com.wiki-memory.compile</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${_worker_path}</string>
    <string>--once</string>
  </array>
  <key>StartInterval</key> <integer>300</integer>
  <key>RunAtLoad</key>     <false/>
  <key>StandardOutPath</key> <string>${VAULT_PATH}/wiki/.worker-stdout.log</string>
  <key>StandardErrorPath</key> <string>${VAULT_PATH}/wiki/.worker-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$claude_bin"):/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key> <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST
    echo "     PLIST"
    echo ""
    echo "  2. Load it:"
    echo "     launchctl load $_plist_file"
    echo ""
    echo "  3. Verify:"
    echo "     launchctl list | grep wiki-memory"
    echo ""
    echo "  To unload: launchctl unload $_plist_file"
  else
    echo "  Platform detected: Linux — using cron"
    echo ""
    echo "  Add this line to your crontab (crontab -e):"
    echo ""
    echo "  # wiki-memory auto-compile — every 5 minutes"
    echo "  */5 * * * * PATH=$(dirname "$claude_bin"):/usr/local/bin:/usr/bin:/bin HOME=$HOME bash ${_worker_path} --once >> ${VAULT_PATH}/wiki/.worker.log 2>&1"
    echo ""
    echo "  Or run once to append automatically:"
    echo "  (crontab -l 2>/dev/null; echo '*/5 * * * * PATH=$(dirname "$claude_bin"):/usr/local/bin:/usr/bin:/bin HOME=$HOME bash ${_worker_path} --once >> ${VAULT_PATH}/wiki/.worker.log 2>&1') | crontab -"
  fi
  echo ""
fi

# ── Success output ─────────────────────────────────────────────────────────────
echo ""
echo "[wiki-memory] Memory capture ENABLED"
echo "  Scope:         $SCOPE"
echo "  Hooks:         SessionStart, PreCompact, SessionEnd"
echo "  Vault:         $VAULT_PATH"
echo "  Config:        $SIDECAR_FILE"
echo "  Backup:        $BACKUP_PATH"
echo "  Auto-compile:  $AUTO_COMPILE_MODE"
echo ""
echo "  Disable:  /wiki-memory disable"
echo "  Status:   /wiki-memory status"
echo "  Flush:    /wiki-memory flush"
echo ""
echo "  PRIVACY: Captured transcripts contain your full conversation history."
echo "  Add raw/sessions/ to your vault's .gitignore before committing."
echo "  Review transcripts before running /wiki-ingest — scrub sensitive data."
