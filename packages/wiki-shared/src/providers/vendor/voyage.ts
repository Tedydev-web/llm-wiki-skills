/**
 * voyage.ts — Voyage AI embedding adapter.
 *
 * Embedding: voyage-3-large (1024 dimensions default)
 * LLM:       NOT SUPPORTED — Voyage AI is embedding-only.
 * Vision:    NOT SUPPORTED — Voyage AI is embedding-only.
 *
 * SDK: voyageai (npm) — Apache-2.0 licensed, not AGPL, no propagation risk.
 *      Voyage AI is the 4th vendor in the capability matrix filling the
 *      Anthropic embedding gap (Anthropic has no native embedding API).
 *
 * API reference: https://docs.voyageai.com/reference/embeddings-api
 */

import type {
  EmbeddingProvider,
  LlmProvider,
  VisionProvider,
  EmbeddingResult,
  CompletionResult,
  VisionResult,
  LlmMessage,
  ToolDef,
  ProviderConfig,
} from '../provider-types.js';
import {
  ProviderCapabilityError,
  ProviderAuthError,
  ProviderRateLimitError,
} from '../provider-types.js';

// ---------------------------------------------------------------------------
// Voyage AI REST types (minimal — avoid tight SDK coupling)

interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type?: 'document' | 'query';
}

interface VoyageEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

// ---------------------------------------------------------------------------
// Cost constant (approximate, USD per 1k tokens)

const VOYAGE_3_LARGE_PER_1K = 0.00006;
const VOYAGE_API_BASE = 'https://api.voyageai.com/v1';

// ---------------------------------------------------------------------------
// Voyage Embedding adapter

export class VoyageEmbeddingAdapter implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  static readonly DIMENSIONS = 1024;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'voyage-3-large';
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const body: VoyageEmbedRequest = {
      input: texts,
      model: this.model,
      input_type: 'document',
    };

    let res: Response;
    try {
      res = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure
      throw new Error(`Voyage AI network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthError('voyage', `HTTP ${res.status}`);
    }
    if (res.status === 429) {
      throw new ProviderRateLimitError('voyage');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Voyage AI error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as VoyageEmbedResponse;

    // Sort by index to ensure ordering matches input
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    const vectors = sorted.map((d) => d.embedding);
    const totalTokens = data.usage?.total_tokens ?? 0;
    const costUsd = (totalTokens / 1000) * VOYAGE_3_LARGE_PER_1K;

    return { vectors, dimensions: VoyageEmbeddingAdapter.DIMENSIONS, costUsd };
  }
}

// ---------------------------------------------------------------------------
// Voyage LLM adapter — explicitly unsupported

export class VoyageLlmAdapter implements LlmProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: ProviderConfig) {}

  async complete(_opts: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    maxTokens: number;
  }): Promise<CompletionResult> {
    throw new ProviderCapabilityError('voyage', 'llm');
  }
}

// ---------------------------------------------------------------------------
// Voyage Vision adapter — explicitly unsupported

export class VoyageVisionAdapter implements VisionProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: ProviderConfig) {}

  async caption(_opts: {
    imageBytes: Uint8Array;
    mimeType: string;
    prompt: string;
  }): Promise<VisionResult> {
    throw new ProviderCapabilityError('voyage', 'vision');
  }
}
