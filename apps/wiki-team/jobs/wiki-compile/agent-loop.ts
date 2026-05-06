/**
 * agent-loop.ts — multi-turn tool-calling control flow for wiki compilation.
 * Control flow ONLY. Prompt → prompts/v1.md. Tool schemas → tool-definitions.ts.
 *
 * Invariants: STEP_BUDGET=30 | CompletionSignal exits cleanly | cost-cap checked
 * each turn | unknown tool: 1 retry then fail | recursion guard via env var.
 * LLM: Anthropic claude-sonnet-4-5 (phase-06 §LLM provider lock).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { AuthContext } from '../../auth/auth-context.js';
import type { CostMeter } from './cost-meter.js';
import { loadSystemPrompt } from './prompts/prompt-loader.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';

import { handleListCatalog, listCatalogInputSchema } from './tools/list-catalog.js';
import { handleSearchNotes, searchNotesInputSchema } from './tools/search-notes.js';
import { handleReadNote, readNoteInputSchema } from './tools/read-note.js';
import { handleExcerptMaterial, excerptMaterialInputSchema } from './tools/excerpt-material.js';
import { handleUpsertNote, upsertNoteInputSchema } from './tools/upsert-note.js';
import { handleLinkNotes, linkNotesInputSchema } from './tools/link-notes.js';
import { handleComplete, completeInputSchema, CompletionSignal, type CompleteOutput } from './tools/complete.js';

// ---------------------------------------------------------------------------
// Constants — own values per phase-06 spec

export const STEP_BUDGET = 30;
const MODEL_ID = 'claude-sonnet-4-5';

export interface AgentLoopInput {
  ctx: AuthContext;
  workspaceId: string;
  kbId: string;
  materialId: string;
  materialText: string;
  costMeter: CostMeter;
}

export interface AgentLoopResult {
  output: CompleteOutput;
  stepsUsed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK tool_use input is untyped
async function dispatchTool(
  toolName: string,
  toolInput: any,
  ctx: AuthContext,
  materialText: string,
): Promise<string> {
  switch (toolName) {
    case 'listCatalog':
      return JSON.stringify(await handleListCatalog(ctx, listCatalogInputSchema.parse(toolInput)));
    case 'searchNotes':
      return JSON.stringify(await handleSearchNotes(ctx, searchNotesInputSchema.parse(toolInput)));
    case 'readNote':
      return JSON.stringify(await handleReadNote(ctx, readNoteInputSchema.parse(toolInput)));
    case 'excerptMaterial':
      return JSON.stringify(
        await handleExcerptMaterial(ctx, excerptMaterialInputSchema.parse(toolInput), materialText),
      );
    case 'upsertNote':
      return JSON.stringify(await handleUpsertNote(ctx, upsertNoteInputSchema.parse(toolInput)));
    case 'linkNotes':
      return JSON.stringify(await handleLinkNotes(ctx, linkNotesInputSchema.parse(toolInput)));
    case 'complete':
      handleComplete(completeInputSchema.parse(toolInput)); // always throws CompletionSignal
      throw new Error('unreachable');
    default:
      throw Object.assign(
        new Error(`unknown-tool: "${toolName}" is not a registered tool`),
        { code: 'unknown-tool', toolName },
      );
  }
}

// runWikiCompile — anti-trace rename per phase-06 map
export async function runWikiCompile(input: AgentLoopInput): Promise<AgentLoopResult> {
  if (process.env['WIKI_COMPILE_INTERNAL_INVOCATION'] === '1') {
    throw Object.assign(
      new Error('recursion-guard: WIKI_COMPILE_INTERNAL_INVOCATION is set'),
      { code: 'recursion-detected' },
    );
  }

  const systemPrompt = loadSystemPrompt();
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  const messages: MessageParam[] = [{
    role: 'user',
    content:
      `Compile material into wiki notes. Workspace: ${input.workspaceId} KB: ${input.kbId} ` +
      `MaterialID: ${input.materialId} Length: ${input.materialText.length} chars. ` +
      `Start with listCatalog, then excerptMaterial, write notes, call complete() when done.`,
  }];

  let stepsRemaining = STEP_BUDGET;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let unknownToolRetry = false;

  while (stepsRemaining > 0) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Cost-cap check
    const costResult = await input.costMeter.recordTokens(
      input.workspaceId,
      response.usage.input_tokens,
      response.usage.output_tokens,
    );
    if (!costResult.ok) {
      throw Object.assign(
        new Error(
          `cost-cap-hit: workspace ${input.workspaceId} exceeded daily cap ` +
          `(total: ${costResult.totalTodayMicroUsd} µUSD, cap: ${costResult.capMicroUsd} µUSD)`,
        ),
        { code: 'cost-cap-hit' },
      );
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') break;

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== 'tool_use') continue;

      const startMs = Date.now();
      let resultContent: string;
      let isError = false;

      try {
        resultContent = await dispatchTool(block.name, block.input, input.ctx, input.materialText);
        unknownToolRetry = false;
      } catch (err) {
        if (err instanceof CompletionSignal) {
          console.info(`[agent-loop] complete() after ${STEP_BUDGET - stepsRemaining + 1} steps`);
          return {
            output: err.output,
            stepsUsed: STEP_BUDGET - stepsRemaining + 1,
            totalInputTokens,
            totalOutputTokens,
          };
        }

        const errCode = (err as { code?: string }).code;

        if (errCode === 'rbac-denied' || errCode === 'cost-cap-hit' || errCode === 'recursion-detected') {
          throw err;
        }

        if (errCode === 'unknown-tool' && !unknownToolRetry) {
          unknownToolRetry = true;
          resultContent = JSON.stringify({ error: (err as Error).message,
            hint: 'Valid: listCatalog searchNotes readNote excerptMaterial upsertNote linkNotes complete' });
          isError = true;
        } else if (errCode === 'unknown-tool') {
          throw Object.assign(
            new Error(`tool-drift: unknown tool "${(err as { toolName?: string }).toolName}" called twice`),
            { code: 'tool-drift' });
        } else {
          resultContent = JSON.stringify({ error: (err as Error).message });
          isError = true;
        }
      }

      console.info(`[agent-loop] tool=${block.name} dur=${Date.now() - startMs}ms err=${isError}`);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent, is_error: isError });
    }

    messages.push({ role: 'user', content: toolResults });
    stepsRemaining--;
  }

  throw Object.assign(
    new Error(`step-budget-exhausted: agent did not call complete() within ${STEP_BUDGET} steps`),
    { code: 'step-budget-exhausted' },
  );
}

// parseCrossReferences — anti-trace rename per phase-06 map
export function parseCrossReferences(content: string): string[] {
  const pattern = /\[\[([a-z0-9-]{1,40})\]\]/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) seen.add(match[1]);
  }
  return Array.from(seen);
}
