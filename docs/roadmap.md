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

### v1.2.0 ✅ (2026-05-05)

- **Auto-compile native mode** — `wiki-memory enable --auto-compile native` with cron + launchd schedulers (G1, ADR 006)
- **Multi-layer recursion guard** — env-var (Layer 1) + verified `claude -p` env propagation spike (Layer 2) + per-session lockdir (Layer 3)
- **Daily cost cap** — configurable `max_ingests_per_day`; refuses + logs when limit hit; manual recovery
- **Sidecar config** — `~/.config/wiki/sidecar.json` with schema versioning + 7-day grace migration from v1.1 plain-text (G3, ADR 005)
- **6-layer test pyramid** — L1 markdown lint + L2 schema invariants + L3 hash lockfile + L4 golden snapshots + L5 real-LLM gated ($0.50/PR + $20/month) + L6 smoke (G2)
- **Lint Step 16+17** — `_schema` version audit + `.memory.log` cross-reference audit (G4)
- **References refactor** — `wiki-ingest` + `wiki-lint` SKILL.md trimmed; deep specs in `references/` subdirs (G6)
- **Cross-skill frontmatter consistency** — `model:` field dropped from `wiki-memory/SKILL.md` (G5)
- **Security hardening** — fs-type refusal (NFS/SMB/cloud-sync), F9 symlink defense, F10 session_id sanitization, F6 atomic cost counter, F8 umask 077

## Planned

### v1.3.0 — Exploratory

**Target:** TBD, dependent on v1.2 stability + user demand

- [ ] **G7: Vector embeddings layer** — semantic search across wiki pages; requires embedding model integration (exploratory)
- [ ] **G8: Vault encryption** — at-rest encryption for sensitive knowledge bases; design TBD (advanced)
- [ ] **G9: Multi-vault routing** — federated search + cross-vault wikilinks; YAGNI until multi-vault use cases emerge

Not committed — each G7/G8/G9 needs its own brainstorm + ADR before scoping. Candidate start: G7 (most user demand, lowest risk).

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
| [005](./decisions/005-sidecar-schema-versioning.md) | Sidecar schema versioning + 7-day grace | Vault discovery for v1.2+ |
| [006](./decisions/006-auto-compile-architecture.md) | Auto-compile architecture + spike result + threat model | Auto-compile design for v1.2 |

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
