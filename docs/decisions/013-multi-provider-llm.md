---
adr: 013
title: Multi-provider LLM/embedding/vision abstraction — ProviderFactory + AES-GCM key storage
status: accepted
date: 2026-05-07
depends-on: [007, 010, 012]
---

# 013 — Multi-provider LLM/embedding/vision abstraction

## Context

v2.0 hard-codes a single embedding model and a single LLM. Three capability gaps block
parity with the target feature set (Settings UI step 3: multi-provider configuration):

1. Admins cannot switch LLM vendors per workspace without a code deploy.
2. No embedding-provider choice — dimension mismatch between vendor models causes silent
   correctness errors in semantic search when models are mixed.
3. Vision captioning is gated on a single vendor.

P01 implementers rely on this ADR alone; no scout report is required.

## Decision

### Provider capability matrix (9 adapter cells, 4 vendors)

| Capability | Anthropic | OpenAI | Google | Voyage AI |
|---|---|---|---|---|
| **LLM** | claude-sonnet-4-5 | gpt-4o | gemini-2.5-pro | — |
| **Embedding** | — *(no native API)* | text-embedding-3-small (1536d) | text-embedding-004 (768d) | voyage-3-large (1024d default) |
| **Vision** | claude-sonnet-4-5 + image blocks *(thin wrapper)* | gpt-4o-vision | gemini-vision | — |

Anthropic has no native embedding API as of v2.1 authoring date; Voyage AI fills that slot
as a fourth vendor for embedding only. Anthropic vision is not a separate API — the vision
adapter (`anthropic-vision.ts`) wraps `anthropic-llm.ts`, passing image bytes as content
blocks in the messages array.

### Interfaces — `packages/wiki-shared/llm-providers/types.ts`

```typescript
interface LlmProvider {
  complete(opts: { messages: LlmMessage[]; tools?: ToolDef[]; maxTokens: number }): Promise<CompletionResult>;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<{ vectors: number[][]; dimensions: number }>;
}

interface VisionProvider {
  caption(opts: { imageBytes: Uint8Array; mimeType: string; prompt: string }): Promise<{ caption: string; costUsd: number }>;
}
```

### ProviderFactory pattern

Single `ProviderFactory` class in `packages/wiki-shared/llm-providers/` (camelCase; snake_case registry pattern from upstream reference is explicitly rejected — see §Alternatives):
- `getLlm(workspaceId): Promise<LlmProvider>`
- `getEmbedding(workspaceId): Promise<EmbeddingProvider>`
- `getVision(workspaceId): Promise<VisionProvider>`

Per-vendor adapter modules: `anthropic-llm.ts`, `openai-llm.ts`, `google-llm.ts`,
`openai-embedding.ts`, `google-embedding.ts`, `voyage-embedding.ts`,
`anthropic-vision.ts`, `openai-vision.ts`, `google-vision.ts`.

### Storage — `provider_settings` table

```
provider_settings (
  id              uuid PK,
  workspace_id    uuid NOT NULL FK workspaces,
  capability      enum('llm','embedding','vision') NOT NULL,
  provider        varchar(50) NOT NULL,       -- 'anthropic' | 'openai' | 'google' | 'voyage'
  model           varchar(100) NOT NULL,
  encrypted_api_key  bytea NOT NULL,
  encryption_metadata jsonb NOT NULL,         -- { epoch, saltHex, ivHex, tagHex }
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, capability)
)
```

### API key encryption — AES-GCM-256 via HKDF

```
key = HKDF-Extract-and-Expand(
        IKM  = BETTER_AUTH_SECRET,
        salt = workspaceId_bytes || uint32BE(secretRotationEpoch),
        info = "provider-api-key-v1",
        len  = 32
      )
ciphertext = AES-GCM-256.encrypt(key, iv=crypto.randomBytes(12), plaintext=apiKey)
```

Per-row salt prevents multi-target attacks. `secretRotationEpoch` (stored in
`encryption_metadata`) enables rotation: bump epoch → new rows use new derived key;
old rows remain readable until re-encrypted asynchronously.

### Vector dimension routing

Active embedding provider determines which column `notes` uses for search:

| Provider | Model | Dimensions | Column |
|---|---|---|---|
| OpenAI | text-embedding-3-small | 1536 | `notes.embedding_1536` |
| Google | text-embedding-004 | 768 | `notes.embedding` |
| Voyage AI | voyage-3-large | 1024 | `notes.embedding_1024` |

P04 migration 0009 adds `embedding_1536` and `embedding_1024` columns + per-cohort
ivfflat indexes. Same-dimension ranking only — cross-dimension search is forbidden at the
query layer (returns `DIMENSION_MISMATCH` error). Per-row tracking: `notes` stores
`embedding_provider`, `embedding_model`, `embedding_dimensions`.

### Rebuild-on-switch

BullMQ job `embedding-rebuild` re-embeds all workspace notes when admin switches embedding
provider. Job is idempotent (upsert by note id + dimension). If a second switch fires
mid-rebuild, a `mid-switch-abort` guard checks active provider before each note; aborts
cleanly without partial corruption.

### Cache invalidation

`provider-settings:invalidate:{workspaceId}` Redis pub/sub channel published on every
`PUT /settings/providers`. All API replicas subscribe; on receipt they evict their LRU
`ProviderFactory` entries for that workspace. Prevents stale credentials in multi-replica
deployments.

### Cost tracking

Per-provider per-workspace daily USD cap tracked via Redis INCR in millicents
(`cents × 1000`) — avoids round-up bias on sub-cent operations (e.g., $0.0001/embed).
Vision cost meter is SEPARATE from LLM cost meter; both use prefix `ws:{id}:cost:` with
distinct suffix keys (`llm_daily`, `vision_daily`).

### Bootstrap + oracle guard

LLM provider is required on first boot; compile fails without one. Embedding + vision are
optional; keyword search fallback activates if embedding is not configured; vision defaults
OFF per workspace.

`POST /settings/providers/test` validates the workspace's stored key only; rejects any
request body key that differs from the stored workspace key. Rate-limited 10 requests/hour
per workspace.

## Consequences

**Positive:**
- Admin can switch providers without redeploy; Settings UI exposes model selection.
- Per-row HKDF salt closes multi-target attack on stored API keys.
- Dimension router prevents silent correctness errors from mixed-model indexes.
- Vision adapter for Anthropic reuses existing LLM adapter; no additional SDK dependency.

**Negative:**
- `embedding-rebuild` BullMQ job can be long-running for large workspaces; UX must surface
  progress. P04 adds progress tracking.
- Three embedding columns require schema migration and conditional query paths.
- Cache-invalidation pub/sub adds operational complexity; subscriber failure risks stale creds
  (mitigated: TTL fallback 5 min in LRU eviction even without pub/sub message).

**Neutral:**
- Voyage AI SDK is a new npm dependency; it is not AGPL — AGPL boundary remains at MuPDF only.
- Provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `voyageai`) are
  MIT/Apache-2 licensed; no AGPL propagation risk.

## Alternatives rejected

- **Single env-var provider (v2.0 approach):** Cannot support per-workspace provider choice;
  blocks multi-tenant use cases. Rejected.
- **Snake_case registry pattern (upstream reference):** Naming leaks upstream implementation
  vocabulary into our TypeScript scaffold; `ProviderFactory` camelCase is used instead. Rejected.
- **Google for embeddings only (no Voyage AI):** Voyage voyage-3-large outperforms
  text-embedding-004 on retrieval benchmarks for long-form technical content. Rejected.
- **Inline key storage (plaintext):** Single DB compromise exposes all tenant API keys.
  AES-GCM-256 + HKDF required. Rejected.
- **Separate HKDF secret:** Would require a new secret variable. Derivation from
  `BETTER_AUTH_SECRET` avoids new operational burden. Accepted.

## References

- ADR 007: TypeScript + Bun stack
- ADR 010: RBAC (workspace-scoped provider settings access)
- ADR 012: MCP tool `workspace.info` exposes `embeddingModel` field
- ADR 015: Vision cost meter (separate from LLM cost meter — see §Cost tracking)
- P01 phase: `ProviderFactory` implementation owns `packages/wiki-shared/llm-providers/`
- P04 phase: vector dimension columns + ivfflat indexes
