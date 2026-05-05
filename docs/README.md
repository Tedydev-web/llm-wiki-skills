# Documentation

Repo-level docs cho contributors + maintainers. User-facing docs (cài đặt, slash commands) ở `README.md` và `CHANGELOG.md` ở project root.

## Audience map

| Bạn là... | Đọc cái này trước |
|---|---|
| Người dùng muốn cài skill | `../README.md` (project root) |
| Contributor muốn add/sửa skill | [contributing.md](./contributing.md) |
| Muốn hiểu kiến trúc repo + schema | [architecture.md](./architecture.md) |
| Tò mò "tại sao quyết định X?" | [decisions/](./decisions/) (ADRs) |
| Muốn xem v1.2/v1.3 có gì | [roadmap.md](./roadmap.md) |
| Muốn xem lịch sử thay đổi | `../CHANGELOG.md` (releases) hoặc [journals/](./journals/) (session notes) |

## Files

- **[project-overview.md](./project-overview.md)** — What/who/scope/non-goals của `llm-wiki-skills`
- **[architecture.md](./architecture.md)** — Repo layout, SKILL.md anatomy, schema v2, hook flow, privacy posture
- **[contributing.md](./contributing.md)** — Add skill, bash style, anti-trace contract, testing, release process
- **[roadmap.md](./roadmap.md)** — Released versions + planned features
- **[decisions/](./decisions/)** — Architecture Decision Records (ADRs); concise, immutable
- **[journals/](./journals/)** — Session journals (release notes, decision-time context)

## Skill-internal references

Mỗi skill có `references/` riêng (Claude Code load on-demand). Repo-level docs **không duplicate** schema/protocol — chỉ link tới:

- Wiki schema chi tiết: [`../skills/wiki/references/wiki-schema.md`](../skills/wiki/references/wiki-schema.md)
- Hook templates: [`../skills/wiki-memory/references/hooks-template.json`](../skills/wiki-memory/references/hooks-template.json)
- QA frontmatter: covered trong [`../skills/wiki-query/SKILL.md`](../skills/wiki-query/SKILL.md)

## Conventions

- **Filename:** kebab-case, descriptive
- **ADRs:** numbered `NNN-short-slug.md`, immutable (mới quyết định = ADR mới supersedes)
- **Journals:** `YYMMDD-HHMM-slug.md` (UTC+7), append-only, per session/release
- **Doc max:** ~150 lines/file. Vượt → tách hoặc link sang skill references
