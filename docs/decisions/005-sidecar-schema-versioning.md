---
adr: 005
title: Sidecar config schema-versioning with backward-compat migration
status: accepted
date: 2026-05-05
---

# 005 — Sidecar config schema-versioning

## Context

v1.1 stored vault path in `~/.config/wiki-memory/vault-path` (plain text, 12 read sites).
v1.2 introduces a new XDG-compliant location `~/.config/wiki/sidecar.json` with structured JSON.
Naive replacement would silently break every v1.1 installation on first upgrade.

Two industry cases document the failure mode of under-specifying config migration:
- kubectl `apiVersion` field: tools that skipped version fields had to perform invasive migrations later (v1beta1 → v1 breakage in 2021).
- AWS CLI v1→v2: even with a 12-month deprecation period and migration guides, post-release issues arose because no programmatic migration was offered — users had to manually re-configure.

Lesson: versioned schema + automatic migration + grace period for downgrade safety eliminates the pain.

## Decision

**Option D — schema-versioned JSON sidecar + hybrid migration + 7-day grace period.**

### New sidecar schema (v1)

```
~/.config/wiki/sidecar.json
{
  "_schema_version": "1",
  "_migration_date": "2026-05-05T14:11:00Z",
  "vault_path": "/abs/path/to/vault",
  "compact_mode": "auto"
}
```

- Directory: `~/.config/wiki/` (mode 700)
- File: `sidecar.json` (mode 600)
- Written atomically: `.tmp.$$` then `mv` (avoids torn reads during concurrent hook fires)
- `umask 077` set before any write

### Read precedence (5 steps, implemented in `lib-vault-discovery.sh`)

```
1. $WIKI_MEMORY_VAULT  (env override — always wins)
2. ~/.config/wiki/sidecar.json  (v1.2+ new location)
3. ~/.config/wiki-memory/vault-path  (v1.1 legacy plain text)
4. <cwd-or-ancestors>/.claude/wiki-memory.conf  (project scope, v1.1 format)
5. Interactive prompt (TTY only — caller decides whether to invoke)
```

Steps 3 and 4 preserve full backward compatibility for v1.1 users.

### Auto-migration logic

Triggered on first `discover_vault()` call after upgrade when:
- Legacy global `~/.config/wiki-memory/vault-path` exists, AND
- New `~/.config/wiki/sidecar.json` does not exist yet.

Migration:
1. Read old plain-text path.
2. Write new JSON with `_schema_version: "1"` and `_migration_date: <now>` (atomic write).
3. Append entry to `~/.config/wiki/migration.log`.
4. Leave old file in place for 7-day grace period.

Migration is idempotent: if new sidecar already exists, migration is skipped entirely.

### 7-day grace period (validation 2026-05-05: vacation-safe)

- Old `~/.config/wiki-memory/vault-path` is preserved for 7 days after migration.
- Opportunistic cleanup: `cleanup_legacy_after_grace()` checks `_migration_date` in the log. If ≥ 7 days have elapsed since migration, the old file is removed.
- Cleanup is never blocking: failure to delete is silently ignored.
- During grace period, a v1.2→v1.1 downgrade still works because the legacy reader in v1.1 finds the original file.

Grace period chosen as 7 days (604800 seconds) because:
- Covers a typical 5-day vacation + 2-day buffer.
- Disk cost is negligible (~50 bytes for the legacy file).
- Longer periods (30 days) would increase risk of stale config confusion.

### Project-scope config

`<dir>/.claude/wiki-memory.conf` (key=value format) is kept in v1.1 format for v1.2.
Migration to JSON deferred to v1.3 if sufficient demand exists.
The 5-step `discover_vault()` function handles both formats without coordination.

## Consequences

**Positive:**
- Zero silent breakage on upgrade from v1.1 to v1.2.
- Downgrade (v1.2→v1.1) within 7-day grace window is fully safe.
- `_schema_version` field enables future migrations without re-building discovery logic.
- Migration log provides audit trail.
- JSON format supports future config fields (e.g. `compact_mode`, per-vault settings).

**Negative:**
- Two config files coexist during 7-day grace (acceptable — ~50 bytes overhead).
- Opportunistic cleanup relies on clock accuracy (UTC); clock skew would delay deletion only, never cause incorrect behavior.

**Neutral:**
- Project-scope format intentionally left as v1.1 (YAGNI: no evidence of demand for migration).

## Alternatives rejected

- **Cut entirely (keep only env var):** Too narrow — breaks users who don't set env vars. Makes the multi-script upgrade invisible to them.
- **In-place path rename only:** Moving `~/.config/wiki-memory/` to `~/.config/wiki/` without schema versioning loses forward-compatibility. First version mismatch = undetectable corruption.
- **Hard cutover (delete v1.1 file immediately on migration):** Breaks v1.1 downgrade within grace window. Violates "do no harm" principle for operational config.
- **30-day grace period:** Extends stale-config confusion window without meaningful safety gain for the use-case (personal developer tooling).

## References

- Phase 01 implementation: `skills/wiki-memory/scripts/lib-vault-discovery.sh`
- Migration log: `~/.config/wiki/migration.log`
- New sidecar: `~/.config/wiki/sidecar.json`
- Legacy sidecar (read-only after migration): `~/.config/wiki-memory/vault-path`
- Integration tests: `tests/wiki-memory/integration/test-sidecar-migration.sh`, `test-vault-discovery.sh`
