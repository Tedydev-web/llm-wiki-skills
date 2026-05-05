---
tags: [qa, fixture-bad]
aliases: ["Bad QA frontmatter example"]
question: "Bad QA frontmatter example"
asked_at: 2026-04-01T12:00:00Z
confidence: extremely-high
sources: "concepts/sample-concept.md"
created: 2026-04-01
updated: 2026-04-01
---

# Bad QA Frontmatter Example

## Answer

This QA file has two frontmatter errors:
1. `confidence` is "extremely-high" — must be high|medium|low
2. `sources` is a bare string — must be a list
3. `answer_summary` field is missing entirely

## Reasoning

Intentionally malformed to test step-14 QA artifact integrity detection.

## Related

- [[concepts/sample-concept]] — related concept
