#!/usr/bin/env bash
# lib-fs-safety.sh — Filesystem safety helpers for wiki-memory auto-compile.
# Source this file: source "$(dirname "$0")/lib-fs-safety.sh"
# Provides: sanitize_session_id(), check_no_symlink(), set_secure_perms(), check_local_fs()
#
# Addresses red-team findings F8 (permissions), F9 (symlink attack),
# F10 (session_id path traversal), F15 (non-local filesystem).
#
# Compatibility: macOS bash 3.2+ and Linux bash 4+. No external deps beyond stat.

# ── Guard: prevent double-source ──────────────────────────────────────────────
# M2 fix: use plain assignment instead of readonly to allow test re-source with
# different stat shims. The guard pattern (check + early return) still works;
# readonly is overkill for a load-guard variable.
[[ -n "${_WIKI_MEMORY_LIB_FS_SAFETY_LOADED:-}" ]] && return 0
_WIKI_MEMORY_LIB_FS_SAFETY_LOADED=1

# ── sanitize_session_id ───────────────────────────────────────────────────────
# F10: validate session_id contains ONLY alphanumerics and dashes.
# Any other character (including '/', '..', newlines) is refused.
# Usage: sanitize_session_id <session_id>
# Returns: 0 if valid, 1 if invalid (caller should exit 0 silently per spec).
sanitize_session_id() {
  local sid="$1"
  if [[ -z "$sid" ]]; then
    echo "[wiki-memory:fs-safety] WARN: empty session_id refused" >&2
    return 1
  fi
  # Bash 3.2-safe regex: [[ =~ ]] without POSIX character classes
  if [[ ! "$sid" =~ ^[a-zA-Z0-9-]+$ ]]; then
    echo "[wiki-memory:fs-safety] WARN: session_id '$sid' failed sanitization (F10)" >&2
    return 1
  fi
  return 0
}

# ── check_no_symlink ──────────────────────────────────────────────────────────
# F9: refuse to operate if the target path is a symbolic link.
# Usage: check_no_symlink <path> [label]
# Returns: 0 if not a symlink, 1 if it is (caller should exit 1 with loud error).
check_no_symlink() {
  local target="$1"
  local label="${2:-$target}"
  if [[ -L "$target" ]]; then
    echo "[wiki-memory:fs-safety] ERROR: '$label' is a symlink — refusing (F9 symlink attack guard)" >&2
    return 1
  fi
  return 0
}

# ── set_secure_perms ──────────────────────────────────────────────────────────
# F8: apply secure permissions to a file or directory.
# Usage: set_secure_perms <path> [file|dir]
#   file (default): chmod 600
#   dir:            chmod 700
# Returns: 0 always (chmod failure is non-fatal but logged).
set_secure_perms() {
  local path="$1"
  local kind="${2:-file}"
  case "$kind" in
    dir)
      chmod 700 "$path" 2>/dev/null || \
        echo "[wiki-memory:fs-safety] WARN: chmod 700 failed on '$path'" >&2
      ;;
    *)
      chmod 600 "$path" 2>/dev/null || \
        echo "[wiki-memory:fs-safety] WARN: chmod 600 failed on '$path'" >&2
      ;;
  esac
  return 0
}

# ── check_local_fs ────────────────────────────────────────────────────────────
# F15: refuse if the given path resides on a non-local filesystem.
# Non-local includes: nfs, nfs4, fuse, fuseblk, smb, cifs, webdav, smbfs.
# Cloud-sync path prefixes are also refused regardless of fs-type report:
#   ~/Library/Mobile Documents/  (iCloud Drive)
#   ~/Dropbox/
#   ~/Google Drive/
#   ~/OneDrive/
# Usage: check_local_fs <path>
# Returns: 0 if local, 1 if non-local (caller should exit 1 with error message).
check_local_fs() {
  local target="$1"

  # ── Cloud-sync path prefix check (fast, before stat) ──────────────────────
  # Expand any leading ~ in target for comparison
  local expanded="${target/#\~/$HOME}"
  case "$expanded" in
    "$HOME/Library/Mobile Documents/"*|\
    "$HOME/Dropbox/"*|\
    "$HOME/Google Drive/"*|\
    "$HOME/OneDrive/"*)
      echo "[wiki-memory:fs-safety] ERROR: vault path appears to be in a cloud-sync directory." >&2
      echo "  Path: $expanded" >&2
      echo "  mkdir-lock atomicity is not guaranteed on cloud-sync filesystems (ADR 003)." >&2
      echo "  Move your vault to a local path and re-run enable." >&2
      return 1
      ;;
  esac

  # ── Filesystem type check via stat ────────────────────────────────────────
  local fs_type=""

  # Try Linux stat first (--file-system -c %T), then macOS BSD stat (-f %T)
  if stat --file-system -c "%T" "$target" >/dev/null 2>&1; then
    # GNU stat (Linux)
    fs_type="$(stat --file-system -c "%T" "$target" 2>/dev/null)" || fs_type=""
  elif stat -f "%T" "$target" >/dev/null 2>&1; then
    # BSD stat (macOS) — %T is filesystem type string
    fs_type="$(stat -f "%T" "$target" 2>/dev/null)" || fs_type=""
  fi

  if [[ -z "$fs_type" ]]; then
    # stat not available or target does not exist — warn but allow (best-effort)
    echo "[wiki-memory:fs-safety] WARN: could not determine filesystem type for '$target'; proceeding" >&2
    return 0
  fi

  # Lowercase for comparison
  local fs_lower
  fs_lower="$(printf '%s' "$fs_type" | tr '[:upper:]' '[:lower:]')"

  case "$fs_lower" in
    nfs|nfs4|fuse|fuseblk|smb|cifs|webdav|smbfs|osxfuse|macfuse)
      echo "[wiki-memory:fs-safety] ERROR: vault is on non-local filesystem: $fs_type" >&2
      echo "  Path: $target" >&2
      echo "  mkdir-lock atomicity (ADR 003) requires a local POSIX filesystem." >&2
      echo "  Supported: apfs, ext4, xfs, btrfs, tmpfs, and other local filesystems." >&2
      return 1
      ;;
  esac

  return 0
}
