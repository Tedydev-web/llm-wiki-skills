#!/usr/bin/env bash
# Test shim for wiki-lint step 14 (Q&A artifact integrity)
# RULE_SOURCE: skills/wiki-lint/references/audit-steps.md:137-212
# RULE_HASH: 8bb86c62ba060d91a1362bb33d1eb6fdc3102c668383983b74387cd335e39f07
# To regenerate: bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-14.sh

# Validates wiki/qa/*.md files: orphan detection (14a), frontmatter validator (14b),
# index schema field check (14c).
# Input: VAULT_DIR (first argument or $VAULT_DIR env)
# Output: ERROR/WARNING/INFO lines per sub-check or OK

set -euo pipefail

VAULT_DIR="${1:-${VAULT_DIR:-}}"
if [ -z "$VAULT_DIR" ]; then echo "ERROR: VAULT_DIR not set" >&2; exit 1; fi

WIKI_DIR="$VAULT_DIR/wiki"
QA_DIR="$WIKI_DIR/qa"
INDEX="$WIKI_DIR/index.md"
FOUND=0

REQUIRED_FIELDS="tags aliases question asked_at confidence answer_summary sources created updated"
VALID_CONFIDENCE="high medium low"

# --- 14a: Orphan QA detection ---
if [ -d "$QA_DIR" ]; then
  for qa_file in "$QA_DIR"/*.md; do
    [ -f "$qa_file" ] || continue
    slug="$(basename "$qa_file" .md)"
    # Check index entry or any wiki page links to this QA slug
    if ! grep -rqE "\[\[qa/$slug\]\]|\[\[$slug\]\]" "$WIKI_DIR" --include="*.md" 2>/dev/null; then
      echo "WARNING step-14a: orphan qa file — $qa_file (no inbound links or index entry)"
      FOUND=$((FOUND + 1))
    fi
  done
fi

# --- 14b: Frontmatter validator ---
if [ -d "$QA_DIR" ]; then
  for qa_file in "$QA_DIR"/*.md; do
    [ -f "$qa_file" ] || continue
    fm="$(awk '/^---/{c++; if(c==2)exit} c==1' "$qa_file" 2>/dev/null)"

    for field in $REQUIRED_FIELDS; do
      if ! echo "$fm" | grep -q "^${field}:"; then
        echo "ERROR step-14b: $qa_file missing required field: $field"
        FOUND=$((FOUND + 1))
      fi
    done

    # confidence must be high|medium|low
    conf="$(echo "$fm" | grep '^confidence:' | head -1 | awk '{print $2}' | tr -d '"' || true)"
    if [ -n "$conf" ]; then
      valid=0
      for v in $VALID_CONFIDENCE; do [ "$conf" = "$v" ] && valid=1 && break; done
      if [ "$valid" -eq 0 ]; then
        echo "ERROR step-14b: $qa_file confidence='$conf' must be high|medium|low"
        FOUND=$((FOUND + 1))
      fi
    fi

    # sources must look like a list (starts with [ or has - prefix in block form)
    sources_line="$(echo "$fm" | grep '^sources:' | head -1 || true)"
    if [ -n "$sources_line" ]; then
      if ! echo "$sources_line" | grep -qE '^sources: *\[|^sources: *$'; then
        # Check if it's a bare string (not a list)
        if echo "$sources_line" | grep -qE '^sources: *[^[\-]'; then
          echo "ERROR step-14b: $qa_file sources field must be a list, not a bare string"
          FOUND=$((FOUND + 1))
        fi
      fi
    fi
  done
fi

# --- 14c: Index schema field check ---
if [ -f "$INDEX" ]; then
  schema_val="$(awk '/^---/{c++; if(c==2)exit} c==1' "$INDEX" \
    | grep '^_schema:' | head -1 | awk '{print $2}' || true)"
  if [ -z "$schema_val" ]; then
    echo "INFO step-14c: wiki/index.md has no _schema field — v1->v2 migration pending; first /wiki-ingest will set _schema: 2"
  elif [ "$schema_val" = "2" ]; then
    echo "OK step-14c: wiki/index.md _schema: 2 (v2 vault)"
  else
    echo "ERROR step-14c: wiki/index.md _schema=$schema_val — expected 2"
    FOUND=$((FOUND + 1))
  fi
fi

if [ "$FOUND" -eq 0 ]; then
  echo "OK: step-14 Q&A artifact integrity: all checks passed"
fi
