---
adr: 001
title: Clean-room implementation, no upstream code copy
status: accepted
date: 2026-05-05
---

# 001 — Clean-room implementation

## Context

`llm-wiki-skills` build trên 2 nguồn cảm hứng public:
- **Karpathy LLM Wiki gist** — pattern dùng Obsidian + LLM ingest pipeline
- **Capture-hook architecture** — ý tưởng dùng Claude Code hooks (SessionStart/PreCompact/SessionEnd) để capture transcript làm input cho ingest

Cần quyết định: copy code upstream, fork, hay reimplement.

## Decision

**Clean-room reimplement.** Lấy ý tưởng + pattern, viết lại 100% code/comments/filenames từ đầu. Enforce "anti-trace contract":

- Zero references trong any file đến: `claude-memory-compiler`, `coleam00`, `Cole`, `uv`, `Agent SDK`, `daily/`, `knowledge/`, `compile.py`, `flush.py`
- Lineage ghi nhận ở README level: chỉ Karpathy gist (public domain pattern)
- Audit chạy qua test script canonical (single source of truth):
  ```bash
  bash tests/wiki-memory/integration/test-anti-trace.sh
  ```
  Script tự exclude: `fixtures/` (test data), `test-anti-trace*` (the test itself), và `docs/` (ADR + meta-references). Phải return exit 0.

## Consequences

**Positive:**
- Full ownership: không phụ thuộc upstream license/maintenance
- Phù hợp scope/style của skills repo (bash + jq, không Python)
- Tự do refactor theo nhu cầu mà không sync với upstream

**Negative:**
- Không hưởng lợi từ upstream bug fixes / new features
- Phải tự maintain toàn bộ surface area
- Effort upfront cao hơn fork

**Neutral:**
- Ý tưởng (capture hooks, schema layout) không phải tài sản trí tuệ độc quyền — chỉ implementation/code mới copyrightable

## Alternatives rejected

- **Fork upstream:** License của upstream repo không rõ ràng (no LICENSE = all rights reserved). Rủi ro pháp lý.
- **Git submodule:** Couples deploy với upstream availability; user phải `git submodule update`.
- **Subprocess wrapper:** Vẫn phải bundle upstream code → cùng vấn đề license.

## References

- Anti-trace audit là 1 step bắt buộc trong [contributing.md](../contributing.md) PR checklist
- Áp dụng kỷ luật từ red-team finding AT-1 (v1.1.0)
