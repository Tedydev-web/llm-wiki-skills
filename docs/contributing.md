# Contributing

Quy trình + conventions cho contributors. Đọc [architecture.md](./architecture.md) trước nếu chưa familiar với repo.

## Setup dev environment

```bash
# Clone + cd
git clone https://github.com/Tedydev-web/llm-wiki-skills.git
cd llm-wiki-skills

# Install skills locally (dev mode, symlinked)
npx skills add . -g --all

# Verify install
npx skills list -g | grep wiki
```

Sau khi cài dev mode (symlink), edit file trong repo → reflect ngay vào `~/.claude/skills/` mà không cần re-install.

## Add skill mới

1. **Tạo dir:** `skills/<kebab-case-name>/`
2. **SKILL.md frontmatter** (required):
   ```yaml
   ---
   name: <kebab-case-name>
   description: "<≤200 chars; mô tả ngắn + subcommand list nếu có>"
   ---
   ```
3. **Body:** Markdown prose Claude đọc khi skill invoked. Document subcommands as sections.
4. **`references/`:** on-demand docs Claude load khi cần (deep schema, templates, examples)
5. **`scripts/`:** bash helpers (executable, `chmod +x`)
6. **Register trong README:** thêm row vào skill table
7. **Tests:** thêm `tests/<skill-name>/` với `run-all.sh`

## Bash style

- **Strict mode:** `set -euo pipefail` ở top mỗi script (TRỪ hooks — xem dưới)
- **Quote everywhere:** `"$path"`, `"$VAR"` — paths với spaces sẽ break nếu unquoted
- **Cross-platform:**
  - Date BSD vs GNU: `date -j -f "%Y-%m-%d" "$d" "+%s"` (macOS) vs `date -d "$d" "+%s"` (Linux). Detect: `if date -j >/dev/null 2>&1; then ...`
  - bash 3.2 KHÔNG có: `mapfile`, associative arrays (`declare -A`), `${var^^}`, `flock`
  - Workarounds: arrays + `read`, parallel arrays, `tr`, `mkdir`-lock (xem [ADR 003](./decisions/003-mkdir-lock-cross-platform.md))
- **Error handling:**
  - Hook scripts: KHÔNG `set -e` ở top level. Wrap body trong `( set -euo pipefail; ... ) || true; exit 0` — PreCompact exit ≠0 BLOCK user session compaction
  - Other scripts: `set -euo pipefail` OK
- **jq defensive parse:** Always `// empty` hoặc `// "default"` để không crash trên missing field:
  ```bash
  session_id="$(jq -r '.session_id // empty' <<< "$STDIN")"
  ```

## Hook script conventions

```bash
#!/usr/bin/env bash
[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0   # self-disable on missing skill

# Recursion guard
[[ -n "${WIKI_MEMORY_INVOKED_BY:-}" ]] && exit 0

(
  set -euo pipefail
  # ... hook body ...
) || true
exit 0
```

**Why:** PreCompact exit code 2 BLOCKS user's session compaction. SessionEnd exit ≠0 shows stderr to user. Both must exit 0 even on internal failure.

## Anti-trace contract

PR checklist (BLOCKING) — chạy test script canonical:
```bash
bash tests/wiki-memory/integration/test-anti-trace.sh
```
Phải return exit 0. Script tự exclude `fixtures/` + `test-anti-trace*` + `docs/`. Detail: [decisions/001](./decisions/001-clean-room-implementation.md).

Lineage references allowed:
- "Karpathy LLM Wiki gist" (public domain pattern reference)
- "capture-hook architecture" (generic concept)

## Testing

```bash
# Run all wiki-memory tests
bash tests/wiki-memory/run-all.sh

# Single test
bash tests/wiki-memory/test-extract-turns.sh
```

**Test pattern (each test file):**
1. Setup: tạo temp dir + fixtures
2. Run: invoke script under test
3. Assert: grep/diff expected output
4. Teardown: trap cleanup
5. Exit 0 on pass, non-zero on fail

**Performance budget:**
- Hook scripts: <2s on 100-turn transcript (baseline measured: 62ms)
- enable/disable: <500ms
- Test suite: <10s tổng

## Release process

1. Bump version trong relevant SKILL.md frontmatter (nếu skill có version)
2. Update `CHANGELOG.md` với entry mới (template: dùng format v1.1.0)
3. Update `docs/roadmap.md` — move planned → released
4. Update `docs/journals/` với release journal (concise; YYMMDD-HHMM-vX-Y-Z-release.md)
5. Anti-trace audit: `grep -ri ...` (xem trên)
6. Smoke test trên fresh `/tmp/test-vault/`:
   ```bash
   mkdir -p /tmp/test-vault/wiki/{concepts,qa} /tmp/test-vault/raw/sessions
   cd /tmp/test-vault && bash <repo>/skills/wiki-memory/scripts/enable-hooks.sh --scope project
   bash <repo>/skills/wiki-memory/scripts/status.sh
   bash <repo>/skills/wiki-memory/scripts/disable-hooks.sh --scope project
   ```
7. Commit: `release: vX.Y.Z — <one-line summary>`
8. Tag: `git tag vX.Y.Z`
9. Push: `git push origin main --tags`
10. Verify: `npx skills update -g` trên fresh machine

## ADR discipline

Quyết định lớn = thêm ADR mới trong `docs/decisions/`:

- **Numbered:** `NNN-short-slug.md` (continue sequential)
- **Immutable:** không sửa ADR đã accepted; quyết định mới = ADR mới với `supersedes: NNN`
- **Concise:** ~1 trang. Sections: Context / Decision / Consequences / Alternatives rejected / References

Trigger writing ADR khi:
- Quyết định ảnh hưởng 2+ skills
- Trade-off lớn (perf vs UX, complexity vs feature)
- Reverse decision sau (ADR cũ → superseded-by ADR mới)

## PR checklist

- [ ] Anti-trace audit: 0 hit
- [ ] Tests pass: `bash tests/<skill>/run-all.sh`
- [ ] SKILL.md description ≤200 chars
- [ ] CHANGELOG entry under "Unreleased"
- [ ] If new skill: README table updated + roadmap if planned feature
- [ ] If decision: ADR added trong `docs/decisions/`
- [ ] Bash strict mode (or hook-wrap pattern for hooks)
- [ ] Cross-platform: tested macOS bash 3.2 (use `bash --version`)
- [ ] No new runtime deps (jq is the only allowed dep; xem [ADR 002](./decisions/002-pure-bash-jq-no-python.md))

## Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `set -e` ở top level hook | PreCompact exit ≠0 → user session compaction blocked | Wrap body trong `( ... ) || true; exit 0` |
| Unquoted path | Vault path với spaces breaks | `"$path"` everywhere |
| Direct flock | Works on Linux, fails macOS | mkdir-lock pattern |
| `mapfile` / `readarray` | bash 4+ only, fails macOS 3.2 | `while IFS= read -r line; do ...; done < file` |
| jq strict parse | Crash trên missing field | Add `// empty` |
| Forget self-disable check | Orphan hook crash sau uninstall | Line 2: `[[ -f "$(dirname "$0")/../SKILL.md" ]] || exit 0` |

## Where to ask

- Architecture questions → đọc [architecture.md](./architecture.md) trước
- "Tại sao quyết định X?" → đọc [decisions/](./decisions/)
- v1.x roadmap → [roadmap.md](./roadmap.md)
- Issues / discussions → GitHub `Tedydev-web/llm-wiki-skills`
