---
_schema: 1
tags: [index, fixture-bad]
created: 2026-04-01
updated: 2026-04-01
---

# Wiki Index (Bad Schema)

This index.md has `_schema: 1` instead of `_schema: 2`.
Demonstrates step-16 (via step 14c) schema version detection.
The lint step expects `_schema: 2`; value `1` triggers an error.

## Sources

- [[sources/sample-note]] — fixture source

## Entities

- [[entities/sample-entity]] — fixture entity
