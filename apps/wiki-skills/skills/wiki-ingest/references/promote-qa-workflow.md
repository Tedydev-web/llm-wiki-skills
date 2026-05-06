---
title: "wiki-ingest — Promote QA Workflow"
loaded_by: wiki-ingest
---

# Promote QA Workflow

Step-by-step specification for `--promote-qa <slug>`: preconditions, mutation steps, and postconditions.

## Promote QA Mode (--promote-qa \<slug\>)

When the user invokes `/wiki-ingest --promote-qa <slug>`, skip the regular ingest pipeline and run this promotion workflow instead.

**Purpose:** Graduate an answered QA page into a permanent concept page.

### Steps

**1. Read the QA page**

Read `wiki/qa/<slug>.md`. If missing, abort with error: `✗ wiki/qa/<slug>.md not found`.

**2. Strip QA-specialized frontmatter fields**

Remove these keys from the YAML frontmatter (they are QA-specific and not valid on concept pages):

- `question`
- `asked_at`
- `confidence`
- `answer_summary`

**3. Drop the `## Reasoning` section**

Remove the entire `## Reasoning` section and its content from the body. This section captures Q-specific thought process and is not needed in the concept page.

**4. Preserve and reformat body**

Keep:
- `## Answer` section — this becomes the concept body
- `## Related` section — keep as-is

**5. Reformat frontmatter for concept page**

Build standard concept frontmatter:

```yaml
---
tags: [concept, promoted-from-qa]
aliases: [<Title Case of slug>]
sources: []
created: <original asked_at date, or today>
updated: <today YYYY-MM-DD>
---
```

Note: `tags: [qa]` from the QA page becomes `tags: [concept, promoted-from-qa]` — the `qa` tag is replaced, not appended.

**6. Write concept page**

Write to `wiki/concepts/<slug>.md`. If the file already exists, warn the user: `⚠ wiki/concepts/<slug>.md already exists — overwrite? (y/n)` and wait for confirmation before proceeding.

**7. Update wiki/index.md**

Add an entry under the `## Concepts` section:

    - [[<Title>]] — one-line summary (under 120 characters)

**8. Append to wiki/log.md**

```
<ISO-timestamp> promote-qa <slug>
```

**9. Original QA page stays unchanged**

`wiki/qa/<slug>.md` is NOT deleted or modified. The user can keep it as historical record or manually delete it later.

After promotion, report to the user: concept page path, QA page path (kept), index entry added.
