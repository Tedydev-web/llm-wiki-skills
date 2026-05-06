# Sample Vault Fixture

Canonical v1.1 schema-compliant test vault for llm-wiki-skills P02 test suite.

**Schema version:** 2 (`.schema-version` file)

## Structure

```
sample-vault/
├── .schema-version          # "2" — vault schema marker
├── wiki/
│   ├── .state.json          # known-good incremental ingest state
│   ├── .memory.log          # session log for P03 step-17 fixtures
│   ├── index.md             # _schema: 2, full category structure
│   ├── cache.md             # hot cache (N1)
│   ├── log.md               # ingest/lint/query activity log
│   ├── sources/sample-note.md
│   ├── entities/sample-entity.md
│   ├── concepts/sample-concept.md
│   ├── synthesis/           # empty — no synthesis pages in base fixture
│   └── qa/how-does-sample-concept-work.md
├── raw/
│   ├── inbox/sample-note.md      # unprocessed source article
│   └── sessions/2026-04-01-1200-fixture-session.md
└── _bad/                    # negative-case inputs (one per lint step)
    ├── step-01-broken-wikilink.md      # broken [[NonExistentPage]] link
    ├── step-02-orphan-page.md          # entity with no inbound links
    ├── step-03-contradiction.md        # conflicting claims in one page
    ├── step-04-stale-claim.md          # page citing only 2020 sources
    ├── step-05-missing-page-wikilink.md # links to nonexistent pages
    ├── step-06-missing-crossref.md     # discusses topic without wikilinks
    ├── step-07-index-inconsistency.md  # entity not listed in index
    ├── step-08-data-gap.md             # frequently-mentioned unwritten topics
    ├── step-09-missing-aliases.md      # entity page without aliases field
    ├── step-10-needs-verification.md   # multiple [needs verification] flags
    ├── step-11-missing-inline-citations.md # claims without (source: ...) refs
    ├── step-12-sources-array-incomplete.md # F3: sources array missing entries
    ├── step-13-stale-cache.md          # cache.md updated 2020, vault has 2026 data
    ├── step-14-qa-bad-frontmatter.md   # QA file with invalid confidence + missing fields
    ├── step-15-state-json-drift.json   # .state.json referencing deleted files
    ├── step-16-schema-version-mismatch.md # index.md with _schema: 1
    └── step-17-orphan-memory-log.md    # placeholder — P03 implements .memory.log audit
```

## Usage

Tests copy this vault to a temp dir before mutating:

```bash
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
cp -r tests/fixtures/sample-vault/. "$tmpdir/"
```

## Maintenance

- When vault schema changes, update `.schema-version` and `wiki/index.md` frontmatter
- When adding new lint steps, add corresponding `_bad/step-NN-*.md` fixture
- Fixture vintage: 2026-04-01 (refresh quarterly or on schema change)
