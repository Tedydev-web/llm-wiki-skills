# Roadmap

Released versions + planned features. Detailed change log: `../CHANGELOG.md`.

## Released

### v1.0.0 ✅ (initial release)

- `wiki` skill — Obsidian vault scaffold + wizard
- `wiki-ingest` skill — raw notes → concept/synthesis pipeline
- `wiki-query` skill — query wiki content
- `wiki-lint` skill — audit pipeline
- Schema v1: `wiki/{concepts,entities,synthesis,index.md}` + `raw/`

### v1.1.0 ✅ (2026-05-05)

- **NEW** `wiki-memory` skill (opt-in) — capture Claude Code transcripts via 3 hooks
- Slash commands: `/wiki-memory enable|disable|status|flush|logs`
- **Schema v2** additions:
  - `raw/sessions/` (auto-captured Claude sessions)
  - `wiki/qa/` (Q&A artifacts từ `/wiki-query --save`)
  - `wiki/.state.json` (sha256 incremental ingest)
  - `wiki/.memory.log` (append-only ops log)
  - `_schema: 2` marker trong `wiki/index.md` frontmatter
- Extended skills:
  - `wiki-query --save <slug>` — write Q&A → `wiki/qa/`
  - `wiki-ingest`: hash skip + `--promote-qa <slug>` (qa→concept promotion)
  - `wiki-lint`: 6 new audits (qa frontmatter, state drift, schema version)
  - `wiki` wizard: Q11 cascade (memory enable/disable + privacy warning)
- Off by default; opt-in via wizard hoặc slash command
- Status command auto-discovers project sidecar từ `$PWD` ancestors (post-release patch 667a5bb)

## Planned

### v1.2.0 — Auto-compile worker

**Target:** Q3 2026 (TBD)

Eliminate manual `/wiki-ingest` step bằng worker process. Required safeguards:

- [ ] **Worker process design**
  - Hook chỉ enqueue job vào `<vault>/.queue/`
  - Daemon hoặc cron drains queue serially
  - Per-job timeout + retry với exponential backoff
- [ ] **File-based session lock**
  - Per-session `.lock` ngăn duplicate ingest cùng session_id
  - Stale lock cleanup heuristic (>1h)
- [ ] **Cost cap config**
  - `max_ingests_per_day` hard stop
  - Token budget tracking per skill
- [ ] **Multi-layer recursion guard**
  - Env var (current `WIKI_MEMORY_INVOKED_BY`)
  - Transcript path detection
  - Lock file
- [ ] **Schema migration tooling** (v2 → v3 nếu cần)
  - `/wiki-migrate <from> <to>` slash command
  - Backup before migrate
  - Dry-run mode

Gate cho v1.2 release: stress test 5 concurrent sessions × 4h, zero data loss / zero duplicate ingest. Detail trong [decisions/004](./decisions/004-defer-auto-compile-v1.2.md).

### v1.3.0 — Cross-vault search (speculative)

**Target:** TBD, dependent v1.2

- [ ] Multi-vault index (federated search across user's vaults)
- [ ] Shared concept library (deduplicate concepts xuất hiện ở nhiều vaults)
- [ ] `wiki-search` skill với BM25/embedding hybrid

Speculative — chỉ ship nếu user demand cao + v1.2 stable.

## Not planned (out of scope)

- ❌ Hosted service / SaaS — repo này là skills, không phải product
- ❌ Multi-user collaboration / RBAC — Obsidian Sync handles
- ❌ Web UI — Obsidian app đủ
- ❌ Mobile app — defer to Obsidian Mobile
- ❌ Real-time sync — out of scope; user dùng Obsidian Sync hoặc git
- ❌ Database backend — vault format = plain markdown, no lock-in
- ❌ CMS replacement — không media management, không rich editor

## Decision log

Quyết định lớn ảnh hưởng roadmap:

| ADR | Decision | Impact roadmap |
|---|---|---|
| [001](./decisions/001-clean-room-implementation.md) | Clean-room reimplement | Không adopt upstream features tự động |
| [002](./decisions/002-pure-bash-jq-no-python.md) | Bash + jq only | Không thêm Python/Node skills |
| [003](./decisions/003-mkdir-lock-cross-platform.md) | mkdir-lock | Limits concurrency model cho v1.2 worker |
| [004](./decisions/004-defer-auto-compile-v1.2.md) | Defer auto-compile | Drives v1.2 scope |

## Versioning policy

- **MAJOR** (v2.0): breaking schema change (e.g., qa frontmatter format change forcing migration)
- **MINOR** (v1.x): new skill, new feature, schema additive (v2 added fields, didn't break v1)
- **PATCH** (v1.x.y): bug fix, doc update, no behavior change

Skill `description` field bumps không count cho version (just tweaks).

## Contributing to roadmap

Đề xuất feature mới:
1. Open GitHub issue với label `enhancement`
2. Mô tả problem + proposed solution + alternatives considered
3. Maintainer triage → assigned milestone hoặc reject với rationale
4. Merged plan → ADR (nếu architectural) → implement
