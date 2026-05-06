---
name: wiki-memory
description: "Optional add-on: capture Claude Code session transcripts as wiki sources for later ingest. Off by default. Subcommands: enable, disable, status, flush, logs."
allowed-tools: Bash Read Write Glob Grep
---

# wiki-memory — Session Transcript Capture

Optional add-on skill that registers Claude Code lifecycle hooks to capture session transcripts into your LLM Wiki vault's raw source directory. Captured transcripts become ingest candidates for `/wiki-ingest`. The skill is **off by default** — nothing runs until you explicitly enable it.

## Privacy Notice

> **WARNING:** Captured transcripts contain your full conversation with the LLM, including any secrets, API keys, passwords, or personal data you have pasted into the session. Before enabling this skill:
>
> - Add `raw/sessions/` to your vault's `.gitignore` (and `.obsidianignore`) before enabling capture.
> - Never commit transcript files to a public or shared repository.
> - Review captured files before running `/wiki-ingest` on them — scrub any sensitive content first.
> - If you work in a shared environment, confirm that your vault storage path is not synced to a shared drive while capture is active.
>
> You accept full responsibility for the content of any captured transcripts.

## Activation

```
/wiki-memory enable [--scope global|project]
```

- `--scope global` — registers hooks in `~/.claude/settings.json` (affects all projects)
- `--scope project` — registers hooks in `./.claude/settings.json` (current project only, default)

Auto-compile on `SessionEnd` is deferred to v1.2 — for now, run `/wiki-ingest` manually after reviewing transcripts.

## Subcommands

| Subcommand | Script | Description |
|---|---|---|
| `enable` | `scripts/enable-hooks.sh` | Register 3 lifecycle hooks in the target `settings.json` |
| `disable` | `scripts/disable-hooks.sh` | Remove hooks from `settings.json`; leave captured files intact |
| `status` | `scripts/status.sh` | Show whether hooks are registered + last capture timestamp |
| `flush` | `scripts/flush-session.sh` | Force-write the current in-progress session buffer to disk |
| `logs` | `scripts/logs.sh` | Tail or page the capture log for the current project/global scope |

## Capture Flow

```
Claude Code lifecycle
        │
        ▼
 ┌──────────────┐   SessionStart hook
 │ hook-session │──► create session buffer file at raw/sessions/<session-id>.md
 │   -start.sh  │
 └──────────────┘
        │
   (conversation in progress)
        │
        ▼
 ┌──────────────┐   PreCompact hook (non-blocking)
 │ hook-pre-   │──► snapshot current transcript to buffer
 │  compact.sh  │   (must not throw — isolated error handling)
 └──────────────┘
        │
        ▼
 ┌──────────────┐   SessionEnd hook
 │ hook-session │──► finalize transcript file, append metadata frontmatter,
 │   -end.sh    │   write to raw/sessions/<session-id>.md
 └──────────────┘
        │
        ▼
 raw/sessions/<session-id>.md  ←── ready for manual /wiki-ingest
```

## Anti-Pattern Warnings

- **Do not edit `settings.json` manually** while hooks are active — use `disable` then `enable` to regenerate entries cleanly.
- **PreCompact hook must never block** — the hook implementation uses isolated error trapping; a failure in snapshot logic will log to `.wiki-memory.log` and exit 0 so Claude Code's compaction proceeds unaffected.
- **Do not run `flush` mid-sentence** — flush captures the buffer as-is; an incomplete exchange will appear truncated in the transcript.
- **Scope mismatch** — if you enabled globally but want per-project overrides, disable globally first to avoid duplicate hook entries.

## Related Files

- `references/hooks-template.json` — hook entry template merged into `settings.json` by `enable-hooks.sh`
- `references/memory-schema.md` — documents the `raw/sessions/` directory layout and `.state.json` format

## Related Skills

- `/wiki-ingest` — processes `raw/` files (including captured transcripts) into structured wiki pages
- `/wiki` — initial vault setup (run before enabling wiki-memory)
- `/wiki-query` — query and synthesize from compiled wiki pages
