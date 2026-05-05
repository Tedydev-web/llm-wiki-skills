#!/usr/bin/env bash
# tests/lib/golden-helpers.sh — L4 golden snapshot helpers
# Compatible: macOS bash 3.2 + Linux bash 4+
#
# Functions:
#   normalize_paths FILE [VAULT_DIR]    — strip temp/abs paths for stable goldens
#   golden_diff ACTUAL_FILE GOLDEN_FILE — diff actual vs golden; auto-create on first run
#   golden_diff_text ACTUAL_TEXT GOLDEN_FILE — same but from a string variable
#
# On mismatch, prints explicit regeneration instructions.

# normalize_paths IN_FILE [VAULT_DIR]
# Replaces absolute temp paths with stable placeholders so goldens are portable.
# Writes normalized content to IN_FILE in-place.
normalize_paths() {
  local file="$1"
  local vault_dir="${2:-}"

  local tmp
  tmp=$(mktemp)

  if [ -n "$vault_dir" ]; then
    # Replace the specific vault temp dir with <VAULT>, then normalize volatile fields
    sed "s|${vault_dir}|<VAULT>|g" "$file" \
      | sed 's/mtime: *[0-9][0-9]*/mtime: <MTIME>/g' > "$tmp"
  else
    # Replace any /tmp/.../tmp.XXXXXXXX/ or /var/folders/.../tmp.XXXXXXXX/ pattern
    # Also normalize mtime values (non-deterministic across runs)
    sed 's|/var/folders/[^ :]*/tmp\.[A-Za-z0-9]*/|<VAULT>/|g;
         s|/tmp/tmp\.[A-Za-z0-9]*/|<VAULT>/|g;
         s|/private/tmp/tmp\.[A-Za-z0-9]*/|<VAULT>/|g;
         s/mtime: *[0-9][0-9]*/mtime: <MTIME>/g' "$file" > "$tmp"
  fi

  mv "$tmp" "$file"
}

# golden_diff ACTUAL_FILE GOLDEN_FILE [VAULT_DIR]
# Returns 0 on match (or first-run snapshot), 1 on mismatch.
golden_diff() {
  local actual="$1"
  local golden="$2"
  local vault_dir="${3:-}"

  if [ ! -f "$actual" ]; then
    echo "ERROR: actual file not found: $actual" >&2
    return 1
  fi

  # Normalize temp paths before comparing
  local normalized
  normalized=$(mktemp)
  cp "$actual" "$normalized"
  normalize_paths "$normalized" "$vault_dir"

  if [ ! -f "$golden" ]; then
    echo "INFO: golden file absent — snapshotting on first run: $golden"
    mkdir -p "$(dirname "$golden")"
    cp "$normalized" "$golden"
    rm -f "$normalized"
    echo "CREATED: $golden"
    return 0
  fi

  local diff_out
  diff_out=$(mktemp)
  if diff -u "$golden" "$normalized" > "$diff_out" 2>&1; then
    rm -f "$diff_out" "$normalized"
    return 0
  else
    echo "FAIL: actual output differs from golden snapshot"
    echo "  Golden: $golden"
    echo "  Actual: $actual"
    echo ""
    cat "$diff_out"
    rm -f "$diff_out" "$normalized"
    echo ""
    echo "  To accept new output as correct baseline, run:"
    echo "    UPDATE_GOLDENS=1 bash <test-script>"
    echo "  Or manually: cp $actual $golden  (after running normalize_paths)"
    return 1
  fi
}

# golden_diff_text ACTUAL_TEXT GOLDEN_FILE
# Writes ACTUAL_TEXT to a temp file then calls golden_diff.
golden_diff_text() {
  local actual_text="$1"
  local golden="$2"

  local tmp_actual
  tmp_actual=$(mktemp)
  printf '%s\n' "$actual_text" > "$tmp_actual"

  if [ "${UPDATE_GOLDENS:-0}" = "1" ]; then
    mkdir -p "$(dirname "$golden")"
    cp "$tmp_actual" "$golden"
    echo "UPDATED golden: $golden"
    rm -f "$tmp_actual"
    return 0
  fi

  golden_diff "$tmp_actual" "$golden"
  local rc=$?
  rm -f "$tmp_actual"
  return $rc
}

# snapshot_or_diff ACTUAL_FILE GOLDEN_FILE [VAULT_DIR]
# Alias for golden_diff; UPDATE_GOLDENS=1 forces update.
snapshot_or_diff() {
  local actual="$1"
  local golden="$2"
  local vault_dir="${3:-}"

  if [ "${UPDATE_GOLDENS:-0}" = "1" ]; then
    local normalized
    normalized=$(mktemp)
    cp "$actual" "$normalized"
    normalize_paths "$normalized" "$vault_dir"
    mkdir -p "$(dirname "$golden")"
    cp "$normalized" "$golden"
    rm -f "$normalized"
    echo "UPDATED golden: $golden"
    return 0
  fi

  golden_diff "$actual" "$golden" "$vault_dir"
}
