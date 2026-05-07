/**
 * index.ts — public barrel export for wiki-shared providers module.
 *
 * Consumers import from '@wiki-team/shared/providers' (or relative path).
 * Only stable public interfaces are exported — internal adapter constructors
 * are intentionally NOT re-exported (use ProviderFactory to obtain adapters).
 */

export type {
  Capability,
  Vendor,
  LlmMessage,
  LlmProvider,
  EmbeddingProvider,
  EmbeddingResult,
  VisionProvider,
  VisionResult,
  CompletionResult,
  ToolDef,
  ToolUse,
  ContentBlock,
  TextContent,
  ImageContent,
  ProviderConfig,
  MessageRole,
} from './provider-types.js';

export {
  ProviderCapabilityError,
  ProviderAuthError,
  ProviderRateLimitError,
} from './provider-types.js';

export { ProviderFactory } from './provider-factory.js';
