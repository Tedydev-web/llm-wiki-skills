#!/usr/bin/env bash
# lib-vault-discovery.sh — Shared vault path discovery for wiki-memory bash scripts.
# Source this file: source "$(dirname "$0")/lib-vault-discovery.sh"
# Exports: discover_vault(), _migrate_legacy(), cleanup_legacy_after_grace()
#
# Read precedence (5 steps):
#   1. $WIKI_MEMORY_VAULT (env override — always wins)
#   2. ~/.config/wiki/sidecar.json (v1.2+ new XDG location)
#   3. ~/.config/wiki-memory/vault-path (v1.1 legacy plain text — auto-migrates on first read)
#   4. <cwd-or-ancestors>/.claude/wiki-memory.conf (project scope, v1.1 key=value format)
#   5. Return 1 (caller handles interactive prompt if TTY)
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+. Requires jq (per ADR 002).
# Security: umask 077 + chmod 600/700 for all sidecar writes (per phase-01 requirements).
# Atomic writes: .tmp.$$ + mv pattern (no torn reads on concurrent hook fires).

# ── Guard: prevent double-source ──────────────────────────────────────────────
[[ -n "${_WIKI_MEMORY_LIB_VAULT_DISCOVERY_LOADED:-}" ]] && return 0
readonly _WIKI_MEMORY_LIB_VAULT_DISCOVERY_LOADED=1

# ── Sidecar path constants ─────────────────────────────────────────────────────
# XDG_CONFIG_HOME is honoured; falls back to ~/.config per XDG spec.
WIKI_NEW_SIDECAR="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/sidecar.json"
WIKI_OLD_SIDECAR_GLOBAL="${XDG_CONFIG_HOME:-$HOME/.config}/wiki-memory/vault-path"
WIKI_MIGRATION_LOG="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/migration.log"

# 7 days in seconds (validation 2026-05-05: vacation-safe grace period).
# This constant MUST NOT be changed without a new ADR (locked per validation 2026-05-05).
WIKI_MIGRATION_GRACE_SECS=604800

# ── _migrate_legacy ────────────────────────────────────────────────────────────
# Internal: copy legacy plain-text vault-path → new JSON sidecar.
# Called automatically by discover_vault() on first read after upgrade.
# Args: $1 = old_path (full path to legacy file), $2 = old_value (vault path string)
# Returns 0 on success, 1 on failure (caller continues with legacy value on failure).
_migrate_legacy() {
  local old_path="$1"
  local old_value="$2"
  local source_script="${0##*/}"

  # Reject symlink at destination directory — prevents symlink redirection attacks.
  local sidecar_dir="${WIKI_NEW_SIDECAR%/*}"
  if [ -L "$sidecar_dir" ]; then
    echo "[wiki-memory] WARN: sidecar dir is a symlink; skipping migration for safety." >&2
    return 1
  fi

  # Secure directory creation: mode 700 per phase-01 security requirements.
  umask 077
  mkdir -p "$sidecar_dir" 2>/dev/null || return 1
  chmod 700 "$sidecar_dir" 2>/dev/null || true

  local tmpfile="${WIKI_NEW_SIDECAR}.tmp.$$"

  # Write new JSON sidecar atomically.
  jq -n \
    --arg v "$old_value" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{_schema_version: "1", _migration_date: $ts, vault_path: $v, compact_mode: "auto"}' \
    > "$tmpfile" 2>/dev/null || { rm -f "$tmpfile" 2>/dev/null; return 1; }

  chmod 600 "$tmpfile" 2>/dev/null || true
  mv "$tmpfile" "$WIKI_NEW_SIDECAR" 2>/dev/null || { rm -f "$tmpfile" 2>/dev/null; return 1; }

  # Append migration audit entry.
  local log_dir="${WIKI_MIGRATION_LOG%/*}"
  mkdir -p "$log_dir" 2>/dev/null || true
  printf '%s migrate from=%s to=%s by=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$old_path" \
    "$WIKI_NEW_SIDECAR" \
    "$source_script" \
    >> "$WIKI_MIGRATION_LOG" 2>/dev/null || true

  return 0
}

# ── discover_vault ─────────────────────────────────────────────────────────────
# Emit vault path on stdout. Return 0 on success, 1 if all sources fail.
# Idempotent: calling multiple times produces at most 1 migration log entry.
# Step 5 (interactive prompt) is NOT handled here — caller checks return code.
discover_vault() {
  # Step 1: env override — always wins.
  [ -n "${WIKI_MEMORY_VAULT:-}" ] && { printf '%s\n' "$WIKI_MEMORY_VAULT"; return 0; }

  # Step 2: new sidecar (v1.2+ JSON).
  # M3: Reject file-level symlink — defense-in-depth beyond directory-level check.
  if [ -L "$WIKI_NEW_SIDECAR" ]; then
    echo "[wiki-memory] WARN: $WIKI_NEW_SIDECAR is a symbolic link; refusing to use" >&2
    # Fall through to legacy sources — do NOT use a symlinked sidecar.
  elif [ -r "$WIKI_NEW_SIDECAR" ]; then
    local _v2
    _v2="$(jq -r '.vault_path // empty' "$WIKI_NEW_SIDECAR" 2>/dev/null)"
    if [ -n "$_v2" ]; then
      # Also check schema_version for future forward-compat (warn but proceed on unknown version).
      local _sv
      _sv="$(jq -r '._schema_version // empty' "$WIKI_NEW_SIDECAR" 2>/dev/null)"
      if [ -n "$_sv" ] && [ "$_sv" != "1" ]; then
        echo "[wiki-memory] WARN: sidecar._schema_version is '$_sv' (expected '1'). Proceeding anyway." >&2
      fi
      printf '%s\n' "$_v2"
      return 0
    fi
    # Corrupt or empty vault_path — fall through to legacy (defensive failsafe).
    echo "[wiki-memory] WARN: sidecar.json exists but vault_path is empty or unparseable; falling back to legacy." >&2
  fi

  # Step 3: legacy global plain-text (v1.1) — auto-migrate on first read.
  if [ -r "$WIKI_OLD_SIDECAR_GLOBAL" ]; then
    local _v3
    # Use head -1 to take the first line, then strip only trailing carriage-returns/newlines.
    # Do NOT tr -d '[:space:]' — that would mangle paths containing spaces.
    _v3="$(head -1 "$WIKI_OLD_SIDECAR_GLOBAL" 2>/dev/null | sed 's/[[:space:]]*$//')"
    if [ -n "$_v3" ]; then
      # Best-effort migration; if it fails, we still return the legacy value.
      _migrate_legacy "$WIKI_OLD_SIDECAR_GLOBAL" "$_v3" 2>/dev/null || true
      printf '%s\n' "$_v3"
      return 0
    fi
    # Empty legacy file — fall through.
  fi

  # Step 4: legacy project-scope walk-up (.claude/wiki-memory.conf, key=value format).
  # M2: Symlink-loop guard — track visited directories to prevent infinite walk-up.
  local _dir="$PWD"
  local _seen_paths=":"
  while [ -n "$_dir" ] && [ "$_dir" != "/" ]; do
    # Detect symlink loop: if we have visited this directory before, abort.
    case "$_seen_paths" in *":$_dir:"*) break ;; esac
    _seen_paths="$_seen_paths$_dir:"
    if [ -r "$_dir/.claude/wiki-memory.conf" ]; then
      local _v4
      _v4="$(grep '^vault-path=' "$_dir/.claude/wiki-memory.conf" 2>/dev/null | head -1 | cut -d= -f2-)"
      if [ -n "$_v4" ]; then
        printf '%s\n' "$_v4"
        return 0
      fi
    fi
    [ "$_dir" = "$HOME" ] && break
    _dir="$(dirname "$_dir")"
  done

  # Step 5: all sources exhausted — caller handles TTY prompt.
  return 1
}

# ── cleanup_legacy_after_grace ─────────────────────────────────────────────────
# Opportunistic cleanup of the legacy plain-text sidecar after the 7-day grace period.
# Call from management scripts (status.sh, enable-hooks.sh) — NEVER from hook scripts
# (hooks must exit fast; cleanup is non-critical and can be deferred).
# Returns 0 always (cleanup failure is silent and non-blocking).
cleanup_legacy_after_grace() {
  # No legacy file — nothing to do.
  [ -f "$WIKI_OLD_SIDECAR_GLOBAL" ] || return 0
  # No migration log — cannot determine when migration happened; leave file alone.
  [ -f "$WIKI_MIGRATION_LOG" ] || return 0

  # Extract the timestamp of the most recent migration event.
  # Log format: "<iso8601_ts> migrate from=... to=... by=..."
  local _migrated_at
  _migrated_at="$(grep ' migrate ' "$WIKI_MIGRATION_LOG" 2>/dev/null | tail -1 | awk '{print $1}')"
  [ -z "$_migrated_at" ] && return 0

  # Cross-platform epoch conversion (macOS BSD date vs GNU date).
  local _mig_epoch
  if date -j >/dev/null 2>&1; then
    # macOS BSD date: -j -f <format> <value> +%s
    _mig_epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$_migrated_at" "+%s" 2>/dev/null)" || return 0
  else
    # GNU date (Linux)
    _mig_epoch="$(date -u -d "$_migrated_at" "+%s" 2>/dev/null)" || return 0
  fi

  [ -z "$_mig_epoch" ] && return 0

  local _now_epoch
  _now_epoch="$(date -u +%s)"

  local _age_secs
  _age_secs=$(( _now_epoch - _mig_epoch ))

  if [ "$_age_secs" -gt "$WIKI_MIGRATION_GRACE_SECS" ]; then
    rm -f "$WIKI_OLD_SIDECAR_GLOBAL" 2>/dev/null || true
  fi

  return 0
}
