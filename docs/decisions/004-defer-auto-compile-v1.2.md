---
adr: 004
title: Defer auto-compile (hook → ingest) to v1.2
status: accepted
date: 2026-05-05
supersedes: none
superseded-by: none (TBD when v1.2 ships)
---

# 004 — Defer auto-compile to v1.2

## Context

v1.1.0 brainstorm proposal ban đầu: SessionEnd hook tự động spawn `claude` để run `/wiki-ingest` ngay sau khi capture, eliminating manual step. UX hấp dẫn: "set & forget".

Red-team finding C-1 (critical) chỉ ra:

1. **Recursion risk:** Hook → spawn `claude` → có thể fire SessionStart hook lại → loop. `WIKI_MEMORY_INVOKED_BY` env guard chỉ cover same-process; subprocess không inherit defensively.
2. **Cost runaway:** Mỗi session ingest = 1 Claude API call (free tier limit + paid tier $$$). Long sessions, multi-window users → 50+ calls/day có thể.
3. **Concurrent ingest:** 2 sessions end simultaneously → 2 ingest processes cùng modify `wiki/.state.json` + `wiki/concepts/`. mkdir-lock chỉ giải quyết single-file; full pipeline lock cần worker queue.

## Decision

**v1.1.0 ships capture-only.** SessionEnd hook chỉ ghi `<vault>/raw/sessions/*.md` rồi exit. User chạy `/wiki-ingest` manually khi muốn (có thể schedule cron).

**Defer auto-compile sang v1.2** với required safeguards:

1. **Dedicated worker process:** Hook chỉ enqueue job vào `<vault>/.queue/`; daemon hoặc cron drains queue serially
2. **File-based session lock:** Per-session `.lock` ngăn duplicate ingest cùng session_id
3. **Cost cap:** Config option `max_ingests_per_day` với hard stop
4. **Recursion guard:** Multi-layer (env var + transcript path detection + lock file)

## Consequences

**Positive (v1.1 capture-only):**
- Ship NGAY với scope đã hardened
- Eliminate critical recursion risk vector
- Predictable cost (zero auto-spend)
- Simpler mental model cho user

**Negative:**
- User phải nhớ chạy `/wiki-ingest` manually (acceptable; có CHANGELOG note)
- v1.2 work backlog: ~5h (worker + queue + locks + tests)

**Neutral:**
- v1.1 user nào muốn auto-ingest có thể set cron tay: `0 */6 * * * cd <vault> && claude --no-interactive "/wiki-ingest"`

## Alternatives rejected

- **Ship với flag `--auto-compile native` opt-in:** Footgun. User opt-in mà không hiểu rủi ro recursion. Privacy + cost surprise.
- **Naive recursion-guard env var:** Insufficient — subprocess không inherit, `WIKI_MEMORY_INVOKED_BY=1` reset trên fresh shell.
- **Block compaction hooks if ingest running:** Block user workflow = unacceptable (PreCompact MUST exit 0; xem ADR-adjacent practice).
- **Ship v1.2 features rolled into v1.1:** +5h effort + delays release; safer to ship v1.1 hardened first.

## References

- Red-team finding C-1 (critical) drove this decision
- v1.2 plan trong [roadmap.md](../roadmap.md)
- v1.1.0 release notes: `CHANGELOG.md` v1.1.0 section "Deferred"
- Manual workflow: `skills/wiki-ingest/SKILL.md`
