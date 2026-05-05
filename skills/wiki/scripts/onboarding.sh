#!/bin/bash
set -e

# LLM Wiki — Onboarding Script
# Scaffolds vault directory structure and verifies CLI tooling.
#
# Usage: bash onboarding.sh <vault-path>
# Output: JSON summary to stdout. Progress messages to stderr.

VAULT_ROOT="${1:-.}"
VAULT_NAME="$(basename "$VAULT_ROOT")"

# Input validation guard — vault name used in sed substitution downstream.
# Reject shell-special chars to avoid escaping issues. (F-1 from red-team review.)
if [[ "$VAULT_NAME" =~ [^a-zA-Z0-9_.-] ]]; then
  echo "ERROR: vault name must contain only [a-zA-Z0-9_.-]. Got: '$VAULT_NAME'" >&2
  echo "       (avoids shell escaping issues in sed substitution)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFS_DIR="$SCRIPT_DIR/../references"

echo "=== LLM Wiki Onboarding ===" >&2

# 1. Create directory structure
echo "Creating directory structure..." >&2
mkdir -p "$VAULT_ROOT/raw/assets"
mkdir -p "$VAULT_ROOT/wiki/sources"
mkdir -p "$VAULT_ROOT/wiki/entities"
mkdir -p "$VAULT_ROOT/wiki/concepts"
mkdir -p "$VAULT_ROOT/wiki/synthesis"
mkdir -p "$VAULT_ROOT/output"
mkdir -p "$VAULT_ROOT/.obsidian"
mkdir -p "$VAULT_ROOT/docs"

# 2. Create wiki/index.md if it doesn't exist
if [ ! -f "$VAULT_ROOT/wiki/index.md" ]; then
  cat > "$VAULT_ROOT/wiki/index.md" << 'EOF'
# Index

Master catalog of all wiki pages. Updated on every ingest.

## Sources

## Entities

## Concepts

## Synthesis
EOF
  echo "Created wiki/index.md" >&2
else
  echo "wiki/index.md already exists, skipping" >&2
fi

# 3. Create wiki/log.md if it doesn't exist
if [ ! -f "$VAULT_ROOT/wiki/log.md" ]; then
  cat > "$VAULT_ROOT/wiki/log.md" << 'EOF'
# Log

Chronological record of all operations.

EOF
  echo "Created wiki/log.md" >&2
else
  echo "wiki/log.md already exists, skipping" >&2
fi

# 4. Create wiki/cache.md skeleton (N1 hot cache, populated by ingest/lint)
if [ ! -f "$VAULT_ROOT/wiki/cache.md" ]; then
  cat > "$VAULT_ROOT/wiki/cache.md" << EOF
---
type: cache
updated: $(date +%Y-%m-%d)
---

# Recent Activity

## Last N ingests
_(empty — populated by /wiki-ingest)_

## Active themes
_(empty — populated by /wiki-lint)_

## Pending
_(empty — populated by /wiki-lint)_
EOF
  echo "Created wiki/cache.md (hot cache — populated by ingest/lint)" >&2
else
  echo "wiki/cache.md already exists, skipping" >&2
fi

# 5. Copy Obsidian app.json defaults (O1, O2)
APP_JSON_TEMPLATE="$REFS_DIR/obsidian-app-json-template.json"
if [ -f "$APP_JSON_TEMPLATE" ]; then
  if [ ! -f "$VAULT_ROOT/.obsidian/app.json" ]; then
    cp "$APP_JSON_TEMPLATE" "$VAULT_ROOT/.obsidian/app.json"
    echo "Created .obsidian/app.json with sane defaults" >&2
  else
    echo ".obsidian/app.json already exists, skipping" >&2
  fi
else
  echo "WARN: app.json template missing at $APP_JSON_TEMPLATE" >&2
fi

# 6. Generate docs/obsidian-setup.md from template (D1, A1) — substitute {{VAULT_NAME}}
SETUP_TEMPLATE="$REFS_DIR/obsidian-setup-template.md"
if [ -f "$SETUP_TEMPLATE" ]; then
  if [ ! -f "$VAULT_ROOT/docs/obsidian-setup.md" ]; then
    sed "s|{{VAULT_NAME}}|$VAULT_NAME|g" "$SETUP_TEMPLATE" > "$VAULT_ROOT/docs/obsidian-setup.md"
    echo "Created docs/obsidian-setup.md (READ THIS — covers §6b aliases requirement)" >&2
  else
    echo "docs/obsidian-setup.md already exists, skipping" >&2
  fi
else
  echo "WARN: obsidian-setup template missing at $SETUP_TEMPLATE" >&2
fi

# 7. Check tooling
echo "" >&2
echo "Checking tooling..." >&2

TOOLS_JSON="[]"

check_tool() {
  local name="$1"
  local cmd="$2"
  local install_cmd="$3"
  local status="missing"

  if command -v "$cmd" &> /dev/null; then
    status="installed"
    echo "  [ok] $name" >&2
  else
    echo "  [missing] $name — install with: $install_cmd" >&2
  fi

  # Build JSON array with jq (no Python dependency — per ADR 002).
  TOOLS_JSON="$(printf '%s' "$TOOLS_JSON" | \
    jq --arg n "$name" --arg s "$status" --arg i "$install_cmd" \
    '. + [{"name": $n, "status": $s, "install": $i}]' 2>/dev/null || printf '%s' "$TOOLS_JSON")"
}

check_tool "summarize" "summarize" "npm i -g @steipete/summarize"
check_tool "qmd" "qmd" "npm i -g @tobilu/qmd"
check_tool "agent-browser" "agent-browser" "npm i -g agent-browser && agent-browser install"

echo "" >&2
echo "Onboarding complete." >&2

# 8. Q11 — Optional: Session Memory Capture
#    Pre-create schema dirs unconditionally (schema-ready even if user declines)
VAULT_DIR="$(cd "$VAULT_ROOT" && pwd)"
mkdir -p "$VAULT_DIR/raw/sessions" "$VAULT_DIR/wiki/qa"

MEMORY_STATUS="skipped"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Idempotency: skip Q11 if hooks already active for this vault.
# Check both new JSON sidecar (v1.2+) and legacy plain-text sidecar (v1.1).
_NEW_SIDECAR="${XDG_CONFIG_HOME:-$HOME/.config}/wiki/sidecar.json"
_OLD_SIDECAR="${XDG_CONFIG_HOME:-$HOME/.config}/wiki-memory/vault-path"
_sidecar_vault=""
if [[ -f "$_NEW_SIDECAR" ]]; then
  _sidecar_vault="$(jq -r '.vault_path // empty' "$_NEW_SIDECAR" 2>/dev/null || true)"
elif [[ -f "$_OLD_SIDECAR" ]]; then
  _sidecar_vault="$(cat "$_OLD_SIDECAR" 2>/dev/null | tr -d '[:space:]' || true)"
fi
if [[ -n "$_sidecar_vault" ]] && [[ "$_sidecar_vault" == "$VAULT_DIR" ]]; then
  echo "" >&2
  echo "Memory capture already active for this vault. Skipping Q11." >&2
  MEMORY_STATUS="already-active"
# Skill-presence guard: Q11 requires wiki-memory skill installed
elif [[ ! -d "$SKILL_DIR/wiki-memory" ]]; then
  echo "" >&2
  echo "NOTE: wiki-memory skill not found — skipping memory capture option." >&2
  echo "      Install it later: npx skills add Tedydev-web/llm-wiki-skills" >&2
  MEMORY_STATUS="skill-missing"
else
  # Q11 main — default OFF
  echo "" >&2
  echo "─── Optional: Session Memory Capture ───" >&2
  echo "Save your Claude Code conversations as wiki sources?" >&2
  echo "Useful for mining decisions and lessons later." >&2
  echo "⚠️  Privacy: transcripts contain whatever you've pasted." >&2
  read -r -p "Enable? [y/N, default N]: " enable_memory </dev/tty

  if [[ "$enable_memory" =~ ^[Yy]$ ]]; then
    # Q11a — scope
    read -r -p "  Scope? [global/project] (default: global): " scope </dev/tty
    scope="${scope:-global}"
    if [[ ! "$scope" =~ ^(global|project)$ ]]; then
      echo "  Invalid scope; defaulting to global." >&2
      scope="global"
    fi

    # Invoke enable-hooks.sh — failure must NOT fail the wizard
    if bash "$SKILL_DIR/wiki-memory/scripts/enable-hooks.sh" \
        --scope "$scope" \
        --vault "$VAULT_DIR"; then
      MEMORY_STATUS="enabled-$scope"
    else
      echo "" >&2
      echo "Memory hooks setup failed but wizard continues." >&2
      echo "Run /wiki-memory enable later to retry." >&2
      MEMORY_STATUS="hooks-failed"
    fi

    # Privacy reminder
    cat >&2 <<'PRIVEOF'

⚠️  Captured transcripts contain your full conversation, including any
    secrets, API keys, or sensitive content you paste. Review before
    committing the vault publicly. Recommend:
        echo "raw/sessions/" >> .gitignore

PRIVEOF
    echo "Memory capture enabled. Toggle: /wiki-memory disable" >&2
  else
    echo "Skipped. You can enable later: /wiki-memory enable" >&2
    MEMORY_STATUS="skipped"
  fi
fi

# 9. Output JSON result to stdout
VAULT_ABS="$VAULT_DIR"
cat << JSONEOF
{
  "status": "complete",
  "vault_root": "$VAULT_ABS",
  "vault_name": "$VAULT_NAME",
  "directories": [
    "raw/",
    "raw/assets/",
    "raw/sessions/",
    "wiki/",
    "wiki/sources/",
    "wiki/entities/",
    "wiki/concepts/",
    "wiki/synthesis/",
    "wiki/qa/",
    "output/",
    ".obsidian/",
    "docs/"
  ],
  "files": [
    "wiki/index.md",
    "wiki/log.md",
    "wiki/cache.md",
    ".obsidian/app.json",
    "docs/obsidian-setup.md"
  ],
  "tools": $TOOLS_JSON,
  "memory_capture": "$MEMORY_STATUS"
}
JSONEOF
