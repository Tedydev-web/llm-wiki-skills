/**
 * anthropic.ts — Anthropic SDK adapters for LLM and Vision capabilities.
 *
 * LLM:       claude-sonnet-4-5 (tool-calling via tools array)
 * Embedding: NOT SUPPORTED — Anthropic has no native embedding API as of v2.1.
 *            AnthropicEmbeddingAdapter throws ProviderCapabilityError on any call.
 * Vision:    Thin wrapper around AnthropicLlmAdapter — sends image bytes as
 *            content blocks in messages[]. NOT a standalone Anthropic vision API.
 *            P03 fills implementation detail for production use.
 *
 * SDK: @anthropic-ai/sdk — MIT licensed, no AGPL propagation risk.
 */

import Anthropic from '@anthropic-ai/sdk';
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
import {
  ProviderCapabilityError,
  ProviderAuthError,
  ProviderRateLimitError,
} from '../provider-types.js';

// ---------------------------------------------------------------------------
// Cost constants (approximate, USD per 1k tokens)

const SONNET_IN_PER_1K = 0.003;
const SONNET_OUT_PER_1K = 0.015;

// ---------------------------------------------------------------------------
// Helpers

function mapToAnthropicMessages(
  messages: LlmMessage[],
): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role as 'user' | 'assistant';
      if (typeof m.content === 'string') {
        return { role, content: m.content };
      }
      const content: Anthropic.ContentBlockParam[] = m.content.map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text };
        // Image content block — base64 encoded bytes
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: b.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: Buffer.from(b.imageBytes).toString('base64'),
          },
        };
      });
      return { role, content };
    });
}

function extractSystemPrompt(messages: LlmMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system');
  if (!sys) return undefined;
  return typeof sys.content === 'string' ? sys.content : undefined;
}

function handleAnthropicError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new ProviderAuthError('anthropic', err.message);
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new ProviderRateLimitError('anthropic');
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Anthropic LLM adapter

export class AnthropicLlmAdapter implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-5';
  }

  async complete(opts: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    maxTokens: number;
  }): Promise<CompletionResult> {
    try {
      const systemPrompt = extractSystemPrompt(opts.messages);
      const messages = mapToAnthropicMessages(opts.messages);

      const tools: Anthropic.Tool[] | undefined = opts.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object' as const,
          ...(t.inputSchema as Record<string, unknown>),
        },
      }));

      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: opts.maxTokens,
        messages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(tools ? { tools } : {}),
      });

      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      const costUsd =
        (inputTokens / 1000) * SONNET_IN_PER_1K +
        (outputTokens / 1000) * SONNET_OUT_PER_1K;

      const contentBlocks: { type: 'text'; text: string }[] = [];
      const toolUses: CompletionResult['toolUses'] = [];

      for (const block of res.content) {
        if (block.type === 'text') {
          contentBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      return { contentBlocks, toolUses, inputTokens, outputTokens, costUsd };
    } catch (err) {
      handleAnthropicError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic Embedding adapter — explicitly unsupported
// Anthropic has no native embedding API as of v2.1 authoring date.

export class AnthropicEmbeddingAdapter implements EmbeddingProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: ProviderConfig) {}

  async embed(_texts: string[]): Promise<EmbeddingResult> {
    throw new ProviderCapabilityError('anthropic', 'embedding');
  }
}

// ---------------------------------------------------------------------------
// Anthropic Vision adapter
// IMPORTANT: This is a wrapper around AnthropicLlmAdapter — sends image as
// content block in messages[]. NOT a standalone Anthropic vision API.
// P03 fills implementation detail for production image captioning pipeline.

export class AnthropicVisionAdapter implements VisionProvider {
  private llmAdapter: AnthropicLlmAdapter;

  constructor(config: ProviderConfig) {
    this.llmAdapter = new AnthropicLlmAdapter({
      apiKey: config.apiKey,
      model: config.model || 'claude-sonnet-4-5',
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
