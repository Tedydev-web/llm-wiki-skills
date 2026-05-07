/**
 * provider-factory.ts — ProviderFactory: workspace-scoped adapter resolution.
 *
 * Factory methods (ADR 013 §ProviderFactory pattern — camelCase; snake_case
 * registry pattern from upstream reference is explicitly rejected):
 *   getLlm(workspaceId)       → LlmProvider
 *   getEmbedding(workspaceId) → EmbeddingProvider
 *   getVision(workspaceId)    → VisionProvider
 *
 * Each method accepts an already-decrypted ProviderConfig so the factory
 * itself is stateless; callers (api route layer) handle DB fetch + decrypt.
 * LRU cache and Redis pub/sub invalidation live in apps/wiki-team/providers/
 * (not here — wiki-shared has no DB/Redis access).
 */

import type {
  Capability,
  Vendor,
  LlmProvider,
  EmbeddingProvider,
  VisionProvider,
  ProviderConfig,
} from './provider-types.js';
import { ProviderCapabilityError } from './provider-types.js';

// Vendor adapter imports
import {
  AnthropicLlmAdapter,
  AnthropicEmbeddingAdapter,
  AnthropicVisionAdapter,
} from './vendor/anthropic.js';
import {
  OpenAILlmAdapter,
  OpenAIEmbeddingAdapter,
  OpenAIVisionAdapter,
} from './vendor/openai.js';
import {
  GoogleLlmAdapter,
  GoogleEmbeddingAdapter,
  GoogleVisionAdapter,
} from './vendor/google.js';
import {
  VoyageLlmAdapter,
  VoyageEmbeddingAdapter,
  VoyageVisionAdapter,
} from './vendor/voyage.js';

// ---------------------------------------------------------------------------
// ProviderFactory — stateless adapter factory (ADR 013 §ProviderFactory pattern)

export class ProviderFactory {
  /**
   * getLlm — returns an LlmProvider for the given vendor config.
   * Supported: anthropic, openai, google.
   * Voyage has no LLM capability — throws ProviderCapabilityError.
   */
  static getLlm(vendor: Vendor, config: ProviderConfig): LlmProvider {
    switch (vendor) {
      case 'anthropic': return new AnthropicLlmAdapter(config);
      case 'openai':    return new OpenAILlmAdapter(config);
      case 'google':    return new GoogleLlmAdapter(config);
      case 'voyage':    return new VoyageLlmAdapter(config); // throws on complete()
      default: {
        const _exhaustive: never = vendor;
        throw new ProviderCapabilityError(_exhaustive as Vendor, 'llm');
      }
    }
  }

  /**
   * getEmbedding — returns an EmbeddingProvider for the given vendor config.
   * Supported: openai (1536d), google (768d), voyage (1024d).
   * Anthropic has no native embedding API — throws ProviderCapabilityError.
   */
  static getEmbedding(vendor: Vendor, config: ProviderConfig): EmbeddingProvider {
    switch (vendor) {
      case 'openai':    return new OpenAIEmbeddingAdapter(config);
      case 'google':    return new GoogleEmbeddingAdapter(config);
      case 'voyage':    return new VoyageEmbeddingAdapter(config);
      case 'anthropic': return new AnthropicEmbeddingAdapter(config); // throws on embed()
      default: {
        const _exhaustive: never = vendor;
        throw new ProviderCapabilityError(_exhaustive as Vendor, 'embedding');
      }
    }
  }

  /**
   * getVision — returns a VisionProvider for the given vendor config.
   * Supported: anthropic (LLM wrapper), openai, google.
   * Voyage has no vision capability — throws ProviderCapabilityError.
   *
   * Note: AnthropicVisionAdapter is a wrapper around AnthropicLlmAdapter —
   * sends image as content block in messages[]. NOT a standalone Anthropic
   * vision API. P03 fills production implementation detail.
   */
  static getVision(vendor: Vendor, config: ProviderConfig): VisionProvider {
    switch (vendor) {
      case 'anthropic': return new AnthropicVisionAdapter(config);
      case 'openai':    return new OpenAIVisionAdapter(config);
      case 'google':    return new GoogleVisionAdapter(config);
      case 'voyage':    return new VoyageVisionAdapter(config); // throws on caption()
      default: {
        const _exhaustive: never = vendor;
        throw new ProviderCapabilityError(_exhaustive as Vendor, 'vision');
      }
    }
  }

  /**
   * getProvider — generic dispatch by Capability enum.
   * Returns union type; callers must narrow based on capability.
   */
  static getProvider(
    capability: 'llm',
    vendor: Vendor,
    config: ProviderConfig,
  ): LlmProvider;
  static getProvider(
    capability: 'embedding',
    vendor: Vendor,
    config: ProviderConfig,
  ): EmbeddingProvider;
  static getProvider(
    capability: 'vision',
    vendor: Vendor,
    config: ProviderConfig,
  ): VisionProvider;
  static getProvider(
    capability: Capability,
    vendor: Vendor,
    config: ProviderConfig,
  ): LlmProvider | EmbeddingProvider | VisionProvider {
    switch (capability) {
      case 'llm':       return ProviderFactory.getLlm(vendor, config);
      case 'embedding': return ProviderFactory.getEmbedding(vendor, config);
      case 'vision':    return ProviderFactory.getVision(vendor, config);
      default: {
        const _exhaustive: never = capability;
        throw new Error(`Unknown capability: ${String(_exhaustive)}`);
      }
    }
  }
}
