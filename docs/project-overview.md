# Project Overview

## What is `llm-wiki-skills`?

Một bộ Claude Code skills để build & maintain personal knowledge wiki dạng Obsidian markdown. Distributed via `npx skills` ecosystem.

## Audience

- Developers đang dùng **Claude Code** (CLI/desktop/IDE extension)
- Muốn build personal knowledge management trên **Obsidian** vault format (plain markdown + YAML frontmatter)
- Sẵn sàng dùng **bash + jq + Obsidian** stack (không server, không database)

## Skills shipped

| Skill | Slash command | Purpose |
|---|---|---|
| `wiki` | `/wiki` | Onboarding wizard: scaffold vault structure, configure Obsidian |
| `wiki-ingest` | `/wiki-ingest` | Convert raw notes/clippings → wiki concepts/synthesis pages (incremental hash skip) |
| `wiki-query` | `/wiki-query` | Query wiki + optionally save Q&A artifacts to `wiki/qa/` |
| `wiki-lint` | `/wiki-lint` | Audit vault: broken links, missing frontmatter, citation drift, schema drift, QA validation |
| `wiki-memory` (v1.1) | `/wiki-memory` | **Optional opt-in.** Capture Claude Code session transcripts via hooks → `raw/sessions/` |

## Scope

**In scope:**
- Personal/single-user wiki workflow
- Obsidian-compatible vault layout (works directly trong Obsidian app)
- Claude Code skill format (SKILL.md + bash scripts + references)
- Schema versioning (current: v2)
- Hooks-based session capture (opt-in)
- Anti-trace contract: zero references to upstream proprietary code (xem ADR 001)

**Out of scope (non-goals):**
- Hosted service / SaaS
- Multi-user collaboration / RBAC
- Web UI / mobile app
- Real-time sync (Obsidian Sync handles này; chúng tôi không thay thế)
- CMS replacement (no rich text editor, no media management)
- Cross-vault federation (mỗi vault standalone)

## Distribution model

```bash
# Global install (recommended)
npx skills add Tedydev-web/llm-wiki-skills -g --all

# Update
npx skills update -g

# Remove
npx skills remove wiki wiki-ingest wiki-query wiki-lint wiki-memory -g
```

Symlink mode by default → user pull repo updates = skills auto-update. Copy mode (`--copy`) cho production-pin.

## Lineage

- Pattern: **Karpathy LLM Wiki** gist (public domain) — Obsidian + LLM ingest pipeline ý tưởng
- Capture-hook architecture: ý tưởng dùng Claude Code's lifecycle hooks (SessionStart/PreCompact/SessionEnd) làm capture trigger
- Implementation: 100% own, clean-room (xem [decisions/001](./decisions/001-clean-room-implementation.md))

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Skill format | Markdown SKILL.md + frontmatter | Claude Code native |
| Hook scripts | bash 3.2+ + `jq` | Cross-platform, zero install (xem [ADR 002](./decisions/002-pure-bash-jq-no-python.md)) |
| Storage | Obsidian vault (plain markdown) | User owns data, no lock-in |
| State | `wiki/.state.json` (sha256 hash map) | Incremental ingest, atomic write |
| Concurrency | `mkdir`-based atomic lock | macOS bash 3.2 compat (xem [ADR 003](./decisions/003-mkdir-lock-cross-platform.md)) |

## Status

- **v1.0.0** ✅ shipped — wiki + ingest + query + lint + wizard
- **v1.1.0** ✅ shipped (2026-05-05) — wiki-memory addon, schema v2, QA artifacts
- **v1.2.0** planned — auto-compile worker process (xem [roadmap.md](./roadmap.md))

## Where to go next

- **User cài đặt** → `../README.md` ở project root
- **Contributor** → [contributing.md](./contributing.md)
- **Hiểu kiến trúc** → [architecture.md](./architecture.md)
- **Quyết định historical** → [decisions/](./decisions/)
