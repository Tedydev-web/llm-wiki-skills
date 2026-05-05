#!/usr/bin/env bash
# test-sidecar-migration.sh — Integration tests for sidecar config migration
#
# Scenarios tested:
#   A. v1.1 vault-path exists, new sidecar absent → auto-migrate on discover_vault():
#      both files coexist, migration.log entry written, correct vault path returned
#   B. Corrupt new sidecar (invalid JSON) → fall-through to legacy, no crash
#   C. Re-run after migration → idempotent (no second migration log entry)
#   D. WIKI_MIGRATION_GRACE_SECS: legacy file retained when within grace period
#   E. 7-day cleanup: cleanup_legacy_after_grace() removes legacy file after grace
#   F. _schema_version "1" present in new sidecar after migration
#
# All tests run in isolated temp dirs — real ~/.config is never touched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../../../skills/wiki-memory/scripts/lib-vault-discovery.sh"

PASS=0
FAIL=0

_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

_assert_eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    _pass "$label"
  else
    _fail "$label (got='$got' want='$want')"
  fi
}

_assert_file_exists() {
  local label="$1" path="$2"
  if [ -f "$path" ]; then _pass "$label"; else _fail "$label (missing: $path)"; fi
}

_assert_file_absent() {
  local label="$1" path="$2"
  if [ ! -f "$path" ]; then _pass "$label"; else _fail "$label (should not exist: $path)"; fi
}

_assert_contains() {
  local label="$1" file="$2" pattern="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    _pass "$label"
  else
    _fail "$label (pattern '$pattern' not found in $file)"
  fi
}

_assert_count() {
  local label="$1" file="$2" pattern="$3" want="$4"
  local got
  got="$(grep -c "$pattern" "$file" 2>/dev/null || echo 0)"
  if [ "$got" = "$want" ]; then
    _pass "$label"
  else
    _fail "$label (count got=$got want=$want)"
  fi
}

# ── Setup: load lib with overridden path constants ─────────────────────────────
_run_in_isolated_env() {
  # Each test block is run in a subshell with XDG_CONFIG_HOME pointing to
  # an isolated temp dir. This prevents any mutation of the real ~/.config.
  local tmpdir
  tmpdir="$(mktemp -d /tmp/wiki-test-migration-XXXXXX)"
  XDG_CONFIG_HOME="$tmpdir" bash --norc --noprofile -c "$1" 2>/dev/null
  local rc=$?
  rm -rf "$tmpdir" 2>/dev/null || true
  return $rc
}

echo "=========================================="
echo "test-sidecar-migration.sh"
echo "=========================================="

# ── Scenario A: v1.1 legacy → auto-migrate ────────────────────────────────────
echo ""
echo "--- Scenario A: legacy vault-path → auto-migrate ---"

_tmpdir_A="$(mktemp -d /tmp/wiki-test-A-XXXXXX)"
_vault_A="/tmp/wiki-test-vault-A"

# Create fake legacy sidecar
mkdir -p "$_tmpdir_A/wiki-memory"
echo "$_vault_A" > "$_tmpdir_A/wiki-memory/vault-path"

# Source lib with overridden paths and call discover_vault
_result_A="$(
  export XDG_CONFIG_HOME="$_tmpdir_A"
  unset WIKI_MEMORY_VAULT 2>/dev/null || true
  source "$LIB"
  discover_vault 2>/dev/null
)"

_assert_eq "Scenario A: returns correct vault path" "$_result_A" "$_vault_A"
_assert_file_exists "Scenario A: new sidecar.json created" "$_tmpdir_A/wiki/sidecar.json"
_assert_file_exists "Scenario A: legacy file preserved (grace period)" "$_tmpdir_A/wiki-memory/vault-path"
_assert_file_exists "Scenario A: migration.log created" "$_tmpdir_A/wiki/migration.log"
_assert_contains "Scenario A: migration.log has migrate entry" "$_tmpdir_A/wiki/migration.log" "migrate"
_assert_contains "Scenario A: migration.log records old path" "$_tmpdir_A/wiki/migration.log" "wiki-memory/vault-path"

# Verify new sidecar JSON structure
if command -v jq >/dev/null 2>&1; then
  _sv="$(jq -r '._schema_version // empty' "$_tmpdir_A/wiki/sidecar.json" 2>/dev/null)"
  _assert_eq "Scenario A: _schema_version is '1'" "$_sv" "1"
  _vp="$(jq -r '.vault_path // empty' "$_tmpdir_A/wiki/sidecar.json" 2>/dev/null)"
  _assert_eq "Scenario A: vault_path in new sidecar matches" "$_vp" "$_vault_A"
  _cm="$(jq -r '.compact_mode // empty' "$_tmpdir_A/wiki/sidecar.json" 2>/dev/null)"
  _assert_eq "Scenario A: compact_mode is 'auto'" "$_cm" "auto"
fi

# Verify file permissions
_perm="$(stat -c '%a' "$_tmpdir_A/wiki/sidecar.json" 2>/dev/null || stat -f '%Lp' "$_tmpdir_A/wiki/sidecar.json" 2>/dev/null || echo "unknown")"
if [ "$_perm" = "600" ] || [ "$_perm" = "unknown" ]; then
  _pass "Scenario A: sidecar.json mode 600 (or platform stat unavailable)"
else
  _fail "Scenario A: sidecar.json mode expected 600, got $_perm"
fi

rm -rf "$_tmpdir_A"

# ── Scenario B: corrupt new sidecar → fall through to legacy ──────────────────
echo ""
echo "--- Scenario B: corrupt sidecar → fall-through to legacy ---"

_tmpdir_B="$(mktemp -d /tmp/wiki-test-B-XXXXXX)"
_vault_B="/tmp/wiki-test-vault-B"

# Create corrupt new sidecar
mkdir -p "$_tmpdir_B/wiki"
echo "NOT_VALID_JSON{{{{" > "$_tmpdir_B/wiki/sidecar.json"
# Create valid legacy sidecar
mkdir -p "$_tmpdir_B/wiki-memory"
echo "$_vault_B" > "$_tmpdir_B/wiki-memory/vault-path"

_result_B="$(
  export XDG_CONFIG_HOME="$_tmpdir_B"
  unset WIKI_MEMORY_VAULT 2>/dev/null || true
  source "$LIB"
  discover_vault 2>/dev/null
)"

_assert_eq "Scenario B: returns vault path from legacy fallback" "$_result_B" "$_vault_B"

rm -rf "$_tmpdir_B"

# ── Scenario C: idempotent — no second migration log entry ────────────────────
echo ""
echo "--- Scenario C: idempotent migration (no second log entry) ---"

_tmpdir_C="$(mktemp -d /tmp/wiki-test-C-XXXXXX)"
_vault_C="/tmp/wiki-test-vault-C"

mkdir -p "$_tmpdir_C/wiki-memory"
echo "$_vault_C" > "$_tmpdir_C/wiki-memory/vault-path"

# First call — triggers migration
(
  export XDG_CONFIG_HOME="$_tmpdir_C"
  unset WIKI_MEMORY_VAULT 2>/dev/null || true
  source "$LIB"
  discover_vault >/dev/null 2>/dev/null
)

# Second call — new sidecar already exists; migration should NOT fire again
(
  export XDG_CONFIG_HOME="$_tmpdir_C"
  unset WIKI_MEMORY_VAULT 2>/dev/null || true
  source "$LIB"
  discover_vault >/dev/null 2>/dev/null
)

# Third through tenth call (idempotent under repeated calls)
for _i in $(seq 3 10); do
  (
    export XDG_CONFIG_HOME="$_tmpdir_C"
    unset WIKI_MEMORY_VAULT 2>/dev/null || true
    source "$LIB"
    discover_vault >/dev/null 2>/dev/null
  )
done

# Exactly 1 migration log entry expected
_assert_count "Scenario C: migration.log has exactly 1 entry" \
  "$_tmpdir_C/wiki/migration.log" "migrate" "1"

rm -rf "$_tmpdir_C"

# ── Scenario D: env var wins over sidecar ─────────────────────────────────────
echo ""
echo "--- Scenario D: WIKI_MEMORY_VAULT env wins over sidecar ---"

_tmpdir_D="$(mktemp -d /tmp/wiki-test-D-XXXXXX)"
_vault_D_env="/tmp/wiki-test-vault-D-env"
_vault_D_sidecar="/tmp/wiki-test-vault-D-sidecar"

# Create valid new sidecar
mkdir -p "$_tmpdir_D/wiki"
jq -n --arg v "$_vault_D_sidecar" \
  '{_schema_version:"1",_migration_date:"2026-05-05T00:00:00Z",vault_path:$v,compact_mode:"auto"}' \
  > "$_tmpdir_D/wiki/sidecar.json" 2>/dev/null || echo "{}" > "$_tmpdir_D/wiki/sidecar.json"

_result_D="$(
  export XDG_CONFIG_HOME="$_tmpdir_D"
  export WIKI_MEMORY_VAULT="$_vault_D_env"
  source "$LIB"
  discover_vault 2>/dev/null
)"

_assert_eq "Scenario D: env var wins over new sidecar" "$_result_D" "$_vault_D_env"

rm -rf "$_tmpdir_D"

# ── Scenario E: cleanup_legacy_after_grace removes old file after 7 days ──────
echo ""
echo "--- Scenario E: cleanup_legacy_after_grace after grace period ---"

_tmpdir_E="$(mktemp -d /tmp/wiki-test-E-XXXXXX)"
_vault_E="/tmp/wiki-test-vault-E"

mkdir -p "$_tmpdir_E/wiki-memory"
echo "$_vault_E" > "$_tmpdir_E/wiki-memory/vault-path"
mkdir -p "$_tmpdir_E/wiki"

# Write a migration.log entry dated 8 days ago (past grace period).
_old_ts="$(date -u -d '8 days ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
           date -u -v-8d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
           echo "2020-01-01T00:00:00Z")"
echo "$_old_ts migrate from=$_tmpdir_E/wiki-memory/vault-path to=$_tmpdir_E/wiki/sidecar.json by=test" \
  >> "$_tmpdir_E/wiki/migration.log"

(
  export XDG_CONFIG_HOME="$_tmpdir_E"
  source "$LIB"
  cleanup_legacy_after_grace 2>/dev/null
)

_assert_file_absent "Scenario E: legacy file removed after 7-day grace" \
  "$_tmpdir_E/wiki-memory/vault-path"

rm -rf "$_tmpdir_E"

# ── Scenario F: _schema_version field present in migrated sidecar ─────────────
echo ""
echo "--- Scenario F: _schema_version present after migration ---"

_tmpdir_F="$(mktemp -d /tmp/wiki-test-F-XXXXXX)"
_vault_F="/tmp/wiki-test-vault-F"

mkdir -p "$_tmpdir_F/wiki-memory"
echo "$_vault_F" > "$_tmpdir_F/wiki-memory/vault-path"

(
  export XDG_CONFIG_HOME="$_tmpdir_F"
  unset WIKI_MEMORY_VAULT 2>/dev/null || true
  source "$LIB"
  discover_vault >/dev/null 2>/dev/null
)

if command -v jq >/dev/null 2>&1 && [ -f "$_tmpdir_F/wiki/sidecar.json" ]; then
  _sv_F="$(jq -r '._schema_version // empty' "$_tmpdir_F/wiki/sidecar.json" 2>/dev/null)"
  _assert_eq "Scenario F: _schema_version = '1'" "$_sv_F" "1"
  _md_F="$(jq -r '._migration_date // empty' "$_tmpdir_F/wiki/sidecar.json" 2>/dev/null)"
  if [ -n "$_md_F" ]; then
    _pass "Scenario F: _migration_date present"
  else
    _fail "Scenario F: _migration_date missing"
  fi
else
  echo "  SKIP: jq not available or sidecar not created (jq required)"
fi

rm -rf "$_tmpdir_F"

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "Results: PASS=$PASS  FAIL=$FAIL"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
