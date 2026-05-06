/**
 * complete.ts — complete tool: signal agent loop termination
 *
 * The agent calls this tool when it has finished compiling the material into
 * notes and cross-references. The agent loop detects this tool call and exits
 * cleanly rather than exhausting the step budget.
 *
 * No RBAC gate — termination is always permitted (the agent owns its own loop).
 * No DB access.
 *
 * Anti-trace: tool name is `complete`, NOT `finish` (reserved forbidden token).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas

export const completeInputSchema = z.object({
  /** Human-readable summary of what the agent accomplished this run */
  summary: z.string().min(1).max(2000),
  /** Slugs of notes created during this compile run */
  notesCreated: z.array(z.string()).default([]),
  /** Slugs of notes updated during this compile run */
  notesUpdated: z.array(z.string()).default([]),
  /** Number of cross-reference links created */
  linksCreated: z.number().int().min(0).default(0),
});

export type CompleteInput = z.infer<typeof completeInputSchema>;

export const completeOutputSchema = z.object({
  acknowledged: z.literal(true),
  summary: z.string(),
  notesCreated: z.array(z.string()),
  notesUpdated: z.array(z.string()),
  linksCreated: z.number().int().min(0),
});

export type CompleteOutput = z.infer<typeof completeOutputSchema>;

// ---------------------------------------------------------------------------
// CompletionSignal — thrown by handleComplete to bubble up through agent loop

/**
 * CompletionSignal is not an error — it is a structured control-flow signal.
 * The agent loop catches it specifically to distinguish intentional termination
 * from unexpected exceptions.
 */
export class CompletionSignal {
  readonly output: CompleteOutput;

  constructor(output: CompleteOutput) {
    this.output = output;
  }
}

// ---------------------------------------------------------------------------
// Tool handler

/**
 * Handle the `complete` tool call from the agent.
 * Throws CompletionSignal (not an Error) to signal the loop to exit cleanly.
 * The agent loop MUST catch CompletionSignal separately from Error.
 */
export function handleComplete(input: CompleteInput): never {
  const output: CompleteOutput = {
    acknowledged: true,
    summary: input.summary,
    notesCreated: input.notesCreated,
    notesUpdated: input.notesUpdated,
    linksCreated: input.linksCreated,
  };

  // Throw as control flow — caught by agent-loop.ts dispatch handler
  throw new CompletionSignal(output);
}
