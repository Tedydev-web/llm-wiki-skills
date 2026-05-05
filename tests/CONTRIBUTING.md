# Test Suite Maintenance Contract

This document defines the contributor workflow for keeping the 6-layer test pyramid
in sync with SKILL.md prose changes.

## Layer Overview

| Layer | What | Cost | When runs |
|-------|------|------|-----------|
| L1 | Markdown lint + frontmatter structure | Free | Every PR |
| L2 | Schema invariants (required sections, step count) | Free | Every PR |
| L3 | Hash lockfile (RULE_SOURCE/RULE_HASH sync) | Free | Every PR |
| L4 | Golden snapshots (shim output vs baseline) | Free | Every PR |
| L5 | Real LLM gated (claude -p against fixture vault) | ~$0.50/PR | Pre-merge label only |
| L6 | Production smoke (manual checklist) | Manual | Before release tag |

## When You Edit a SKILL.md File

### Step 1: Run L1+L2 (always, free, fast)

```bash
bash tests/lint-skills-structure.sh
```

Checks markdown structure + required frontmatter fields + section presence.
Should pass after any well-formed edit.

### Step 2: Update RULE_HASH for affected shims (L3)

Every shim in `tests/integration/<skill>/shim/` has:

```bash
# RULE_SOURCE: skills/wiki-lint/SKILL.md:48-53
# RULE_HASH: 8a6e93888172b4f27a49c167510eeba22f5cdb80b5b7526b80c342c38d0918c9
```

If you edited lines 48–53 of `skills/wiki-lint/SKILL.md`, the hash no longer matches.
**Regenerate all hashes:**

```bash
bash tests/lib/regenerate-rule-hashes.sh
```

Or regenerate a single shim:

```bash
bash tests/lib/regenerate-rule-hashes.sh tests/integration/wiki-lint/shim/step-04.sh
```

Then verify:

```bash
bash tests/meta/test-rule-hash-sync.sh
```

### Step 3: Review golden snapshots (L4)

If your SKILL.md change alters expected shim output:

```bash
# Run affected test to see diff
bash tests/integration/wiki-lint/test-step-04-stale-claims.sh

# If diff is intentional, regenerate golden
UPDATE_GOLDENS=1 bash tests/integration/wiki-lint/test-step-04-stale-claims.sh
```

Review the diff carefully before committing — golden files are the regression baseline.

### Step 4: Run full L1-L4 suite

```bash
bash tests/run-all-skills.sh
```

Must exit 0 before opening PR.

### Step 5: (Optional) Request L5 on PR

Add the `pre-merge` label to your PR to trigger L5 real-LLM validation.
This costs ~$0.50 and runs only if SKILL.md changed.

**Monthly cap:** $20/month aggregate. If cap is hit, L5 is skipped with a PR comment.

## When You Add a New Audit Step

Four artifacts required per new step (e.g., step 18):

1. **Fixture** — `tests/fixtures/sample-vault/_bad/step-18-<desc>.md`
2. **Shim** — `tests/integration/wiki-lint/shim/step-18.sh`
   - Include `# RULE_SOURCE:` + `# RULE_HASH:` at top
   - Run `bash tests/lib/regenerate-rule-hashes.sh <shim>` to populate hash
3. **Test** — `tests/integration/wiki-lint/test-step-18-<desc>.sh`
4. **Golden** — `tests/golden/wiki-lint/step-18.golden.txt`
   - Created automatically on first test run (first-run snapshot)
   - Review before committing

Update L2 check in `tests/lint-skills-structure.sh` to expect N+1 steps.

## When You Move Prose to references/

If a P05-style refactor moves SKILL.md prose to `skills/<skill>/references/*.md`:

1. Update `# RULE_SOURCE:` pointers in all affected shims to the new file path + line range
2. Run `bash tests/lib/regenerate-rule-hashes.sh` to recompute hashes
3. Run `bash tests/run-all-skills.sh` — L3 will catch any missed pointer updates
4. Run L5 via `pre-merge` label to confirm LLM still finds prose correctly

## Golden Snapshot FAQ

**Q: Golden doesn't exist yet — first run?**
A: On first run, golden is auto-created from actual output. Review before committing.

**Q: Golden diff on CI but not locally?**
A: Usually OS-specific whitespace or path differences. Run on Linux to match CI.
Normalize with `UPDATE_GOLDENS=1` on a clean CI run if needed.

**Q: UPDATE_GOLDENS=1 to accept new behavior?**
A: Run `UPDATE_GOLDENS=1 bash tests/run-all-skills.sh` to regenerate all goldens.
Review every changed golden in the PR diff — this is the human gate.

**Q: How often should goldens be refreshed?**
A: On-demand when behavior intentionally changes. Not on a schedule.

## L3 Hash Lockfile Contract

The RULE_HASH mechanism ensures SKILL.md prose changes cannot silently pass tests:

- Edit SKILL.md lines cited in `RULE_SOURCE:` → L3 hash mismatch → test fails
- Move prose to `references/` → source file path changes → L3 fails
- Either way: contributor must explicitly update RULE_HASH (forces review)

This is the mechanical drift catch (red-team F5 fix). It cannot be accidentally bypassed.

## Test File Conventions

- All tests source `tests/lib/test-helpers.sh` for assertions
- All tests source `tests/lib/golden-helpers.sh` for snapshot diffs
- Each test copies fixture vault to `$(mktemp -d)` and traps cleanup
- Tests never write to `$HOME` or project root — only to `$TMPDIR`
- Use `COUNTER=$((COUNTER + 1))` not `((COUNTER++))` (bash 3.2 portability)
