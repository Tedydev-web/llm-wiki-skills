/**
 * google.ts — Google Gemini SDK adapters for LLM, Embedding, and Vision capabilities.
 *
 * LLM:       gemini-2.5-pro (tool-calling via function declarations)
 * Embedding: text-embedding-004 (768 dimensions)
 * Vision:    gemini-vision (inline image parts in content array)
 *
 * SDK: @google/generative-ai — Apache-2.0 licensed, no AGPL propagation risk.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type Tool,
  type FunctionDeclaration,
  type Part,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
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
// Cost constants (approximate, USD per 1k tokens)

const GEMINI_PRO_IN_PER_1K = 0.00125;
const GEMINI_PRO_OUT_PER_1K = 0.005;
const EMBED_004_PER_1K = 0.00001;

// ---------------------------------------------------------------------------
// Helpers

function mapToGeminiContents(messages: LlmMessage[]): Content[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (typeof m.content === 'string') {
        return { role, parts: [{ text: m.content }] };
      }
      const parts: Part[] = m.content.map((b) => {
        if (b.type === 'text') return { text: b.text };
        return {
          inlineData: {
            mimeType: b.mimeType,
            data: Buffer.from(b.imageBytes).toString('base64'),
          },
        };
      });
      return { role, parts };
    });
}

function extractSystemInstruction(messages: LlmMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system');
  if (!sys) return undefined;
  return typeof sys.content === 'string' ? sys.content : undefined;
}

function handleGoogleError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('401')) {
    throw new ProviderAuthError('google', msg);
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    throw new ProviderRateLimitError('google');
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Google LLM adapter

export class GoogleLlmAdapter implements LlmProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-2.5-pro';
  }

  async complete(opts: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    maxTokens: number;
  }): Promise<CompletionResult> {
    try {
      const systemInstruction = extractSystemInstruction(opts.messages);
      const contents = mapToGeminiContents(opts.messages);

      const toolDeclarations: FunctionDeclaration[] | undefined = opts.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        // Cast through unknown — inputSchema is user-supplied JSON Schema; SDK type
        // (FunctionDeclarationSchema) requires explicit type/properties fields that
        // callers must provide. Cast is safe: invalid schemas fail at API call time.
        parameters: t.inputSchema as unknown as FunctionDeclaration['parameters'],
      }));

      const tools: Tool[] | undefined = toolDeclarations
        ? [{ functionDeclarations: toolDeclarations }]
        : undefined;

      const genModel = this.client.getGenerativeModel({
        model: this.model,
        ...(systemInstruction ? { systemInstruction } : {}),
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: { maxOutputTokens: opts.maxTokens },
        ...(tools ? { tools } : {}),
      });

      const result = await genModel.generateContent({ contents });
      const response = result.response;
      const usageMeta = response.usageMetadata;
      const inputTokens = usageMeta?.promptTokenCount ?? 0;
      const outputTokens = usageMeta?.candidatesTokenCount ?? 0;
      const costUsd = (inputTokens / 1000) * GEMINI_PRO_IN_PER_1K + (outputTokens / 1000) * GEMINI_PRO_OUT_PER_1K;

      const candidate = response.candidates?.[0];
      const contentBlocks: { type: 'text'; text: string }[] = [];
      const toolUses: CompletionResult['toolUses'] = [];

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) contentBlocks.push({ type: 'text', text: part.text });
        if (part.functionCall) {
          toolUses.push({
            id: crypto.randomUUID(),
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }

      return { contentBlocks, toolUses, inputTokens, outputTokens, costUsd };
    } catch (err) {
      handleGoogleError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Google Embedding adapter

export class GoogleEmbeddingAdapter implements EmbeddingProvider {
  private client: GoogleGenerativeAI;
  private model: string;
  static readonly DIMENSIONS = 768;

  constructor(config: ProviderConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'text-embedding-004';
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    try {
      const genModel = this.client.getGenerativeModel({ model: this.model });
      const results = await Promise.all(
        texts.map((t) => genModel.embedContent(t)),
      );
      const vectors = results.map((r) => r.embedding.values);
      // Google embedding API does not return token counts; estimate for cost
      const estimatedTokens = texts.join(' ').split(/\s+/).length;
      const costUsd = (estimatedTokens / 1000) * EMBED_004_PER_1K;
      return { vectors, dimensions: GoogleEmbeddingAdapter.DIMENSIONS, costUsd };
    } catch (err) {
      handleGoogleError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Google Vision adapter

export class GoogleVisionAdapter implements VisionProvider {
  private llmAdapter: GoogleLlmAdapter;

  constructor(config: ProviderConfig) {
    this.llmAdapter = new GoogleLlmAdapter({
      apiKey: config.apiKey,
      model: config.model || 'gemini-2.5-pro',
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
