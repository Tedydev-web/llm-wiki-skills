---
adr: 015
title: Image extraction + vision captioning — async BullMQ queue, cost caps, PII disclosure
status: accepted
date: 2026-05-07
depends-on: [013]
---

# 015 — Image extraction + vision captioning

## Context

v2.0 compile pipeline processes text only; embedded images in PDF and DOCX materials are
silently dropped. Two gaps block parity:

1. No image extraction: figures, diagrams, and screenshots in source materials are invisible
   to semantic search and MCP responses.
2. No vision captioning: even when images are extracted, no caption text is generated for
   retrieval or display.

Inline captioning (blocking compile) is rejected — it raises compile latency by 2–10 s per
image and violates the compile job's text-only contract. Vision runs async.

P03 implementers rely on this ADR alone; no scout report is required. The column name
`image_caption_md` is canonical; the upstream attribute name for this field is a forbidden
trace token and must not appear in scaffold code or prompt files.

## Decision

### Pipeline extension — two-stage async

```
[compile job: wiki-compile queue]
  ├─ text extraction (unchanged — packages/wiki-pdf-extract/, AGPL-bound)
  ├─ image extraction (NEW — same package, same AGPL boundary, worker process only)
  └─ emits: material.compiled event
       │
       ▼
[vision job: vision-captions queue — separate BullMQ queue]
  ├─ per-image sub-job (1 image = 1 job entry)
  ├─ cost-cap check → skip if exceeded
  ├─ provider call → VisionProvider.caption(...)
  ├─ upsert material_images row
  └─ caption text merged into material_excerpt after stream-in
```

Compile completes text-only first. Vision queue is parallel to `wiki-compile`; caption
failures do NOT fail compile. Each image is an independent sub-job — one malformed image
does not block others.

### Image extraction rules (applied before vision queue)

| Condition | Action |
|---|---|
| `byte_size > 5 MB` | skip; `skipped_reason = 'size_exceeded'` |
| `mime_type` not in `{jpeg, png, webp, gif}` | skip; `skipped_reason = 'unsupported_mime'` |
| MuPDF parser exception | BullMQ catch → skip image; log; never crash worker |
| `workspace_settings.vision_enabled = false` | skip entire queue for workspace |

Image extractor runs in worker process only (never in API process). MuPDF image API stays
inside `packages/wiki-pdf-extract/` — AGPL boundary is preserved. Unit test with malformed
PDF fixture is required (P03 deliverable).

### Storage — `material_images` table

```sql
CREATE TABLE material_images (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id      UUID         NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  page_num         INT          NOT NULL,
  image_index      INT          NOT NULL,         -- ordinal within page
  mime_type        VARCHAR(20)  NOT NULL,
  byte_size        INT          NOT NULL,
  storage_key      VARCHAR(500) NULL,             -- MinIO object key; null if skipped
  image_caption_md TEXT         NULL,             -- vision-extracted caption (Markdown)
  caption_provider VARCHAR(50)  NULL,
  caption_cost_usd NUMERIC(10,6) NULL,
  caption_status   VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- 'pending' | 'completed' | 'skipped' | 'failed'
  skipped_reason   VARCHAR(100) NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (material_id, page_num, image_index)
);
```

Upsert: `INSERT ... ON CONFLICT (material_id, page_num, image_index) DO UPDATE SET ...`
Idempotent on re-compile.

### Cost caps — two levels

**Per-material cap:**
```
env: VISION_COST_CAP_USD_PER_MATERIAL (default: 0.50)
workspace override: provider_settings.per_material_vision_cap_usd
```
Vision job checks cumulative cost for the material before each sub-job. If cap would be
exceeded, remaining images skipped with `skipped_reason = 'cost_cap_hit'`.

**Per-workspace daily cap:**
```
Redis key: ws:{workspaceId}:cost:vision_daily
INCR in millicents (cents × 1000) — avoids round-up bias on sub-cent operations
TTL: reset at UTC midnight
```
Vision sub-job rejected before provider call if daily cap exceeded.

Vision cost meter is SEPARATE from LLM cost meter (ADR 013 §Cost tracking). Both use
prefix `ws:{id}:cost:` with distinct suffix keys.

**Retry on cap raise:** `SELECT ... WHERE caption_status='skipped' AND skipped_reason='cost_cap_hit'`
— re-checks cost before proceeding. Only cost-cap-skipped rows are retried; size/mime
skips are permanent.

### Vision providers

Same three vendors as ADR 013. Configured via `ProviderFactory.getVision(workspaceId)`.

| Provider | Implementation |
|---|---|
| Anthropic | `anthropic-vision.ts` — thin wrapper around `anthropic-llm.ts`; image as content block |
| OpenAI | `openai-vision.ts` — gpt-4o-vision |
| Google | `google-vision.ts` — gemini-vision |

### Vision prompt

`apps/wiki-team/jobs/wiki-compile/prompts/vision-v1.md` — authored by fresh-context
subagent per spec-only briefing. Prompt file is NOT excluded from anti-trace scan (must
pass cleanly). Compile prompt bumped `wiki-compile/v1.md` → `v2.md` to gate
caption-insertion on `vision_enabled` flag — prevents prompt regression test breakage.

### PII disclosure + admin opt-in

`workspace_settings.vision_enabled = false` (default). Enabling requires:
1. Admin clicks toggle in Settings → "Image Vision" tab.
2. Confirm modal displayed: *"By enabling vision, image content of every material in this
   workspace may be sent to {provider}. Ensure your data-processing agreements cover this."*
3. On confirm: `vision_enabled` flipped to `true`; `audit_events` row written with
   `event_type = 'workspace.vision.enabled'`, `actor_user_id`, `provider`.

Disabling vision does not delete existing `material_images` rows; captions are retained.
Future re-enable re-uses existing rows (idempotent upsert).

### AGPL boundary

Image extraction uses MuPDF.js image API inside `packages/wiki-pdf-extract/` — already
AGPL-bound. Vision API calls (HTTP to Anthropic/OpenAI/Google) are not AGPL. The boundary
is: MuPDF code → extracts bytes → passes to `VisionProvider.caption()` (non-AGPL adapter).
No AGPL code crosses into the vision adapters.

## Consequences

**Positive:**
- Async queue: compile latency unchanged; vision captions stream in after compile completes.
- Per-image sub-jobs: one bad image cannot block others or crash the worker.
- Two-level cost cap: both per-material and daily workspace caps prevent runaway spend.
- AGPL boundary preserved: vision adapters are clean of MuPDF.

**Negative:**
- `material_images` table grows proportionally with PDF image density; requires periodic
  cleanup job for deleted materials (ON DELETE CASCADE handles it automatically).
- Daily cap Redis key requires UTC-midnight reset logic; misaligned reset risks under- or
  over-charging. Mitigate: TTL set to 86400 s from first INCR of the day, not calendar reset.
- Admin must explicitly opt-in; some users may not discover feature. Mitigate: Settings
  onboarding checklist (P06) surfaces vision toggle.

**Neutral:**
- MinIO storage key per image adds storage cost; images are stored once and reused on
  re-compile (identified by `(material_id, page_num, image_index)` unique key).

## Alternatives rejected

- **Inline captioning (blocking compile):** Increases compile latency 2–10 s per image;
  unacceptable for documents with 50+ figures. Rejected.
- **Single BullMQ job per material (all images):** One image parse error fails the entire
  material's caption run. Per-image sub-jobs isolate failures. Rejected.
- **Store images in Postgres (bytea):** Large blobs degrade Postgres performance; MinIO
  object storage is the correct tier. Rejected.
- **Vision always ON:** PII risk — raw material content sent to third-party without admin
  awareness. Explicit opt-in with confirm modal required. Rejected.
- **Logo-detection heuristic (skip decorative images):** Deferred to v2.2; heuristic adds
  complexity without confirmed accuracy benefit. Rejected.

## References

- ADR 013: `ProviderFactory.getVision()` + vision cost meter (separate from LLM)
- ADR 010: `audit_events` pipeline reused for `workspace.vision.enabled` event
- P03 phase: vision queue implementation owns `apps/wiki-team/jobs/vision-captions/`
- P03 phase: malformed-PDF fixture unit test required
- `packages/wiki-pdf-extract/`: AGPL-bound image extraction; stays within package boundary
