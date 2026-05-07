/**
 * openai.ts — OpenAI SDK adapters for LLM, Embedding, and Vision capabilities.
 *
 * LLM:       gpt-4o (tool-calling via OpenAI function-calling API)
 * Embedding: text-embedding-3-small (1536 dimensions)
 * Vision:    gpt-4o-vision (image via content array with image_url type)
 *
 * SDK: openai (npm) — MIT licensed, no AGPL propagation risk.
 * Each adapter class implements the corresponding Provider interface from provider-types.ts.
 */

import OpenAI from 'openai';
import type {
  LlmProvider,
  EmbeddingProvider,
  VisionProvider,
  LlmMessage,
  ToolDef,
  CompletionResult,
  EmbeddingResult,
  VisionResult,
  ProviderConfig,
} from '../provider-types.js';
import { ProviderAuthError, ProviderRateLimitError } from '../provider-types.js';

// ---------------------------------------------------------------------------
// Helpers

function mapMessages(
  messages: LlmMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    if (typeof m.content === 'string') {
      // Discriminate by role so TypeScript can narrow to the correct union member
      if (m.role === 'system') return { role: 'system', content: m.content };
      if (m.role === 'assistant') return { role: 'assistant', content: m.content };
      return { role: 'user', content: m.content };
    }
    // Multi-part content (for vision) — OpenAI only supports parts on 'user' messages
    const parts: OpenAI.Chat.ChatCompletionContentPart[] = m.content.map((b) => {
      if (b.type === 'text') return { type: 'text' as const, text: b.text };
      const base64 = Buffer.from(b.imageBytes).toString('base64');
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${b.mimeType};base64,${base64}` },
      };
    });
    // For multi-part, treat as user message (vision content blocks are user-side)
    return { role: 'user', content: parts };
  });
}

function handleOpenAIError(err: unknown, vendor = 'openai'): never {
  if (err instanceof OpenAI.AuthenticationError) throw new ProviderAuthError(vendor as 'openai', err.message);
  if (err instanceof OpenAI.RateLimitError) throw new ProviderRateLimitError(vendor as 'openai');
  throw err;
}

// Approximate cost constants (USD per 1k tokens) — used for cost reporting only
const GPT4O_IN_PER_1K = 0.005;
const GPT4O_OUT_PER_1K = 0.015;
const EMBED_SMALL_PER_1K = 0.00002;

// ---------------------------------------------------------------------------
// OpenAI LLM adapter

export class OpenAILlmAdapter implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4o';
  }

  async complete(opts: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    maxTokens: number;
  }): Promise<CompletionResult> {
    try {
      const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = opts.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      }));

      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: mapMessages(opts.messages),
        max_tokens: opts.maxTokens,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
      });

      const choice = res.choices[0];
      const usage = res.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      const inputTokens = usage.prompt_tokens;
      const outputTokens = usage.completion_tokens;
      const costUsd = (inputTokens / 1000) * GPT4O_IN_PER_1K + (outputTokens / 1000) * GPT4O_OUT_PER_1K;

      const contentBlocks = choice?.message?.content
        ? [{ type: 'text' as const, text: choice.message.content }]
        : [];

      const toolUses = (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
      }));

      return { contentBlocks, toolUses, inputTokens, outputTokens, costUsd };
    } catch (err) {
      handleOpenAIError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI Embedding adapter

export class OpenAIEmbeddingAdapter implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  static readonly DIMENSIONS = 1536;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'text-embedding-3-small';
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    try {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        dimensions: OpenAIEmbeddingAdapter.DIMENSIONS,
      });
      const vectors = res.data.map((d) => d.embedding);
      const totalTokens = res.usage?.total_tokens ?? 0;
      const costUsd = (totalTokens / 1000) * EMBED_SMALL_PER_1K;
      return { vectors, dimensions: OpenAIEmbeddingAdapter.DIMENSIONS, costUsd };
    } catch (err) {
      handleOpenAIError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI Vision adapter

export class OpenAIVisionAdapter implements VisionProvider {
  private llmAdapter: OpenAILlmAdapter;

  constructor(config: ProviderConfig) {
    this.llmAdapter = new OpenAILlmAdapter({
      apiKey: config.apiKey,
      model: config.model || 'gpt-4o',
    });
  }

  async caption(opts: {
    imageBytes: Uint8Array;
    mimeType: string;
    prompt: string;
  }): Promise<VisionResult> {
    const result = await this.llmAdapter.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', imageBytes: opts.imageBytes, mimeType: opts.mimeType },
            { type: 'text', text: opts.prompt },
          ],
        },
      ],
      maxTokens: 512,
    });
    const caption = result.contentBlocks.map((b) => b.text).join('');
    return { caption, costUsd: result.costUsd };
  }
}
