# Architecture

High-level kiến trúc cho contributors + maintainers. Schema/protocol chi tiết → link sang skill `references/`.

## Repo layout

```
llm-wiki-skills/
├── README.md                    # User-facing install + quick start
├── CHANGELOG.md                 # Per-release notes
├── LICENSE
├── .gitignore                   # plans/ ignored (dev artifacts)
├── skills/                      # 5 skills, mỗi cái 1 dir
│   ├── wiki/                    #   onboarding wizard
│   ├── wiki-ingest/             #   raw → wiki pipeline
│   ├── wiki-query/              #   query + --save QA
│   ├── wiki-lint/               #   audit pipeline
│   └── wiki-memory/             #   opt-in capture (v1.1)
├── tests/                       # bash test harness
│   └── wiki-memory/             #   13 tests for v1.1 hooks
├── docs/                        # repo-level docs (this dir)
└── plans/                       # planning artifacts (gitignored)
```

## SKILL.md anatomy

Mỗi skill là 1 directory với cấu trúc cố định:

```
skills/<skill-name>/
├── SKILL.md                     # entry point — frontmatter + body
├── references/                  # on-demand docs Claude loads
│   ├── *.md
│   └── *.json
└── scripts/                     # executable helpers (optional)
    └── *.sh
```

`SKILL.md` frontmatter (required fields):
```yaml
---
name: wiki-memory
description: "Optional add-on: capture Claude Code session transcripts as wiki sources for later ingest. Off by default. Subcommands: enable, disable, status, flush, logs."
---
```

Body = markdown prose Claude reads when skill invoked. Subcommands documented as sections.

## Schema v2 (vault layout)

Vault root layout sau khi `/wiki` wizard scaffold:

```
<vault>/
├── .obsidian/                   # Obsidian config (auto-managed)
├── wiki/                        # canonical knowledge base
│   ├── index.md                 # entry point + _schema:2 marker
│   ├── concepts/                # atomic concept pages
│   ├── entities/                # named entities (people/orgs/products)
│   ├── synthesis/               # cross-concept syntheses
│   ├── qa/                      # Q&A artifacts (v2 specialized frontmatter)
│   ├── log.md                   # human-readable activity log
│   ├── cache.md                 # SessionStart inject context
│   ├── .state.json              # sha256 hash map (incremental ingest)
│   └── .memory.log              # append-only ops log (capture timestamps)
└── raw/                         # ingest input (NOT in wiki/ subtree)
    ├── *.md                     # user-clipped articles
    └── sessions/                # auto-captured Claude sessions (v1.1+)
        └── YYYY-MM-DD-HHMM-{id}.md
```

**Schema deep details:** [`../skills/wiki/references/wiki-schema.md`](../skills/wiki/references/wiki-schema.md). Repo-level docs **không duplicate** schema — chỉ reference.

## Hook flow (wiki-memory v1.1)

```
SessionStart event
  ├─ Read stdin {session_id, source}
  ├─ source == "compact"? → exit 0 silent (avoid double-context with PreCompact)
  ├─ Read <vault>/wiki/cache.md + <vault>/wiki/log.md (last 30 lines)
  ├─ Concat + truncate to 20K chars
  └─ Emit JSON: {"hookSpecificOutput": {"hookEventName":"SessionStart","additionalContext": "..."}}

PreCompact event (CRITICAL: must exit 0)
  ├─ Wrap entire body in `( ... ) || true; exit 0`
  ├─ Read transcript_path → extract last 30 turns (≥5 gate)
  ├─ Filename prefix: pre-compact-
  └─ Append to .memory.log via mkdir-lock

SessionEnd event
  ├─ Read transcript_path → extract last 30 turns
  ├─ Cap at 15K chars
  ├─ Filename: YYYY-MM-DD-HHMM-{session_id:0:8}.md
  ├─ Move to <vault>/raw/sessions/
  └─ Append to .memory.log via mkdir-lock
```

**Self-disable check (line 2 mỗi hook):**
```bash
[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0
```
Đảm bảo nếu user uninstall skill mà quên disable hooks → orphan hook tự exit 0 (không break user session).

## Vault config sidecar

Hooks cần biết vault path. Discovery order:

1. Env var: `WIKI_MEMORY_VAULT`
2. Global sidecar: `~/.config/wiki-memory/vault-path` (1 line: vault path)
3. Project sidecar: walk up từ `$PWD` tìm `.claude/wiki-memory.conf` (key=value format), dừng tại `/` hoặc `$HOME`

Status command auto-discover ở mọi subdir của vault.

## Privacy posture

`wiki-memory` capture FULL conversation transcript → có thể chứa:
- API keys / passwords user paste vào prompt
- File contents user share
- Internal codebase details

**Mitigations enforced:**
- **Off by default** — opt-in via `/wiki-memory enable` hoặc wizard Q11
- **Privacy warning** ở 4 chỗ: README, SKILL.md description, wizard prompt, enable command output
- **`.gitignore` recommendation:** `raw/sessions/` vault subdir
- **Manual review:** user chạy `/wiki-ingest` → review trước khi ingest sang `wiki/` (which IS git-tracked)

## Concurrency

3 chỗ atomic write cần lock:
1. `wiki/.memory.log` (hook append)
2. `wiki/.state.json` (ingest hash update)
3. `~/.claude/settings.json` (enable/disable merge)

Lock pattern: `mkdir`-based, 5s timeout. Detail trong [decisions/003](./decisions/003-mkdir-lock-cross-platform.md).

## Anti-trace contract

Mọi PR phải pass audit qua test script (single source of truth):
```bash
bash tests/wiki-memory/integration/test-anti-trace.sh
```
Script tự exclude `fixtures/`, `test-anti-trace*`, và `docs/` (meta-references hợp lệ). Detail trong [decisions/001](./decisions/001-clean-room-implementation.md).

## Cross-references

- Skill schema: [`../skills/wiki/references/wiki-schema.md`](../skills/wiki/references/wiki-schema.md)
- Hooks template: [`../skills/wiki-memory/references/hooks-template.json`](../skills/wiki-memory/references/hooks-template.json)
- Onboarding flow: [`../skills/wiki/scripts/onboarding.sh`](../skills/wiki/scripts/onboarding.sh)
- Test harness: [`../tests/wiki-memory/run-all.sh`](../tests/wiki-memory/run-all.sh)
