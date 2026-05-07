/**
 * provider-types.ts — core provider interfaces and type definitions
 *
 * Capability × Vendor matrix (ADR 013):
 *   LLM:       Anthropic (claude-sonnet-4-5) | OpenAI (gpt-4o) | Google (gemini-2.5-pro)
 *   Embedding: OpenAI (text-embedding-3-small 1536d) | Google (text-embedding-004 768d) | Voyage (voyage-3-large 1024d)
 *   Vision:    Anthropic (LLM wrapper) | OpenAI (gpt-4o-vision) | Google (gemini-vision)
 *   Note: Anthropic has NO native embedding API — throw ProviderCapabilityError.
 */

// ---------------------------------------------------------------------------
// Union literals — camelCase factory pattern (ADR 013 §Anti-trace)

export type Capability = 'llm' | 'embedding' | 'vision';
export type Vendor = 'openai' | 'google' | 'anthropic' | 'voyage';

// ---------------------------------------------------------------------------
// Message + tool types for LLM interface

export type MessageRole = 'user' | 'assistant' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  imageBytes: Uint8Array;
  mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

export interface LlmMessage {
  role: MessageRole;
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionResult {
  contentBlocks: TextContent[];
  toolUses: ToolUse[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Provider interfaces (ADR 013 §Interfaces)

export interface LlmProvider {
  complete(opts: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    maxTokens: number;
  }): Promise<CompletionResult>;
}

export interface EmbeddingResult {
  vectors: number[][];
  dimensions: number;
  costUsd: number;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<EmbeddingResult>;
}

export interface VisionResult {
  caption: string;
  costUsd: number;
}

export interface VisionProvider {
  caption(opts: {
    imageBytes: Uint8Array;
    mimeType: string;
    prompt: string;
  }): Promise<VisionResult>;
}

// ---------------------------------------------------------------------------
// Config passed to adapters after key decryption

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Error types

export class ProviderCapabilityError extends Error {
  constructor(vendor: Vendor, capability: Capability) {
    super(`Vendor "${vendor}" does not support capability "${capability}"`);
    this.name = 'ProviderCapabilityError';
  }
}

export class ProviderAuthError extends Error {
  constructor(vendor: Vendor, message: string) {
    super(`Auth error from "${vendor}": ${message}`);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends Error {
  constructor(vendor: Vendor) {
    super(`Rate limit reached for vendor "${vendor}"`);
    this.name = 'ProviderRateLimitError';
  }
}
