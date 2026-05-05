---
name: wiki-query
description: >
  Answer questions against the LLM Wiki / knowledge base. Use when the user
  asks a question about their collected knowledge, wants to explore
  connections between topics, says "what do I know about X", "ask my
  second brain", or wants to search their wiki.
allowed-tools: Bash Read Write Edit Glob Grep
---

# LLM Wiki — Query

Answer questions by searching and synthesizing knowledge from the wiki.

## Search Strategy

### 1. Start with the index

Read `wiki/index.md` to identify relevant pages. Scan all category sections (Sources, Entities, Concepts, Synthesis) for entries related to the question.

### 2. Use qmd for large wikis

If `qmd` is installed (check with `command -v qmd`), use it for search:

```bash
qmd search "query terms" --path wiki/
```

This is especially useful when the wiki has grown beyond ~100 pages where scanning the index becomes inefficient.

### 3. Read relevant pages

Read the wiki pages identified by the index or search. Follow `[[wikilinks]]` to pull in related context from linked pages. Read enough pages to give a thorough answer, but don't read the entire wiki.

### 4. Check raw sources if needed

If the wiki pages don't fully answer the question, check relevant source summaries in `wiki/sources/` for additional detail. Only go to files in `raw/` as a last resort.

## Synthesize the Answer

### Format

Match the answer format to the question:
- **Factual question** → direct answer with citations
- **Comparison** → table or structured comparison
- **Exploration** → narrative with linked concepts
- **List/catalog** → bulleted list with brief descriptions

### Citations

Always cite wiki pages using `[[wikilink]]` syntax. Example:

> According to [[Source - Article Title]], the key finding was X. This connects to the broader pattern described in [[Concept Name]], which [[Entity Name]] has also explored.

### Offer to save valuable answers

If the answer produces something worth keeping — a comparison, analysis, new connection, or synthesis — offer to save it:

> "This comparison might be useful to keep in your wiki. Want me to save it as a synthesis page?"

If the user agrees:
1. Create a new page in `wiki/synthesis/` with proper frontmatter
2. Add an entry to `wiki/index.md` under Synthesis
3. Append to `wiki/log.md`: `## [YYYY-MM-DD] query | Question summary`

## Conventions

- **Search the wiki first.** Only go to raw sources if the wiki doesn't have the answer.
- **Cite your sources.** Every factual claim should link to the wiki page it came from.
- **Valuable answers compound.** Encourage saving good analyses back into the wiki.
- Use `[[wikilinks]]` for all internal references. Never use raw file paths.

## Flags

| Flag | Description |
|------|-------------|
| `--save` | After answering, persist the Q&A as a structured artifact in `wiki/qa/<slug>.md`. Updates `wiki/index.md` and `wiki/log.md`. |

Without `--save`, behavior is identical to before — no files are written.

## Save Mode (when --save flag present)

Execute the normal query flow first. Once the answer is synthesized, write the QA artifact.

### Slug generation

1. Take the verbatim question string.
2. Lowercase, strip punctuation (keep letters, digits, hyphens), replace spaces with `-`.
3. Truncate at word boundary to **max 60 characters**.
4. If a file already exists at the generated path (collision), append `-<first 8 chars of SHA1 of full question>` as suffix.

Examples:

| Question | Slug |
|---|---|
| "How does X work?" | `how-does-x-work` |
| "What's the diff between A and B?" | `whats-the-diff-between-a-and-b` |
| "(Long question over 60 chars about complex topic Y)" | `long-question-over-60-chars-about-complex-topic-y` |

### Frontmatter template (v2)

```yaml
---
tags: [qa]
aliases: ["<verbatim original question>"]
question: "<verbatim original question>"
asked_at: <ISO-8601 datetime, e.g. 2026-05-05T10:21:00Z>
confidence: high       # high | medium | low  — agent self-rates based on source coverage
answer_summary: "<one-sentence TL;DR>"
sources: [concepts/foo.md, entities/bar.md]   # cited articles resolved to paths
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---
```

All nine fields are required. Always quote `aliases:` and `question:` values — questions often contain special YAML characters (apostrophes, colons, question marks).

`confidence` rating guide:
- **high** — answer is fully supported by two or more wiki pages with direct citations
- **medium** — partial coverage; some claims inferred or from a single source
- **low** — speculative, sparse sources, or answer contains `[needs verification]` flags

### Body template

```markdown
# <Title-cased question>

## Answer
<full synthesized answer with [[wikilinks]] inline citations>

## Reasoning
<chain of evidence: which sources, which key claims, contradictions if any>

## Related
- [[concepts/foo]] — <relevance>
- [[entities/bar]] — <relevance>
```

### Write path

Write the file to `wiki/qa/<slug>.md`.

### Index update

Open `wiki/index.md`, locate the `## Q&A` section (create it under the last category if absent), and append:

```
- [[qa/<slug>]] — <verbatim original question>
```

### Log append

Append one line to `wiki/log.md`:

```
<ISO-timestamp> qa-save: wiki/qa/<slug>.md
```

### Anti-pattern: skip low-confidence saves

If `confidence` would be rated **low** AND the synthesized answer contains `[needs verification]` flags covering more than 50% of claims, **do not write the file**. Instead, print:

```
Warning: answer confidence is low with unverified claims. Save anyway? (yes/no)
```

Wait for user confirmation before proceeding.

### Schema reference

For the full QA article frontmatter spec and field constraints, see `wiki-schema.md` §QA Articles (populated in a later phase).

## Related Skills

- `/wiki-ingest` — process new sources into wiki pages
- `/wiki-lint` — health-check the wiki for issues
