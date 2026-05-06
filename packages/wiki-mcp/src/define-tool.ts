/**
 * define-tool.ts — Typed tool registration helper for MCP SDK Server
 *
 * Returns an SDK-compatible tool registration object:
 *   { name, description, inputSchema (JSON Schema), handler }
 *
 * The handler receives already-parsed input (validated by Zod at call site)
 * and must return a JSON-serialisable value or throw a McpError on failure.
 *
 * Design:
 *   - Zod schema is the single source of truth for I/O shape
 *   - JSON Schema for MCP client tooling is derived via toJsonSchema()
 *   - Handler receives typed (Zod-inferred) input — no `any` in callers
 */

import type { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// ToolDefinition — public interface returned from defineTool

export interface ToolDefinition<TInput extends z.ZodTypeAny> {
  /** MCP tool name (e.g. "wiki.search") */
  name: string;
  /** Human-readable description surfaced to Claude at initialize */
  description: string;
  /** Zod schema used for runtime input validation */
  inputSchema: TInput;
  /**
   * Handler invoked after input validation passes.
   * Return value is wrapped in CallToolResult by the registration adapter.
   * Throw McpError (from @modelcontextprotocol/sdk) for protocol-level errors.
   */
  handler: (input: z.infer<TInput>) => Promise<unknown>;
  /** Pre-compiled MCP Tool descriptor (JSON Schema shape for SDK) */
  mcpTool: Tool;
  /** Internal handler adapter matching SDK CallToolRequestSchema shape */
  mcpHandler: (args: unknown) => Promise<CallToolResult>;
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema conversion (avoids heavy ajv/json-schema-to-zod deps)
// Covers the Zod subset used across the 8 tool input schemas.

type JsonSchemaType =
  | { type: 'object'; properties: Record<string, JsonSchemaNode>; required?: string[] }
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: JsonSchemaNode; description?: string }
  | { anyOf: JsonSchemaNode[] }
  | { description?: string };

type JsonSchemaNode = JsonSchemaType;

/**
 * Convert a Zod schema to a minimal JSON Schema object.
 * Supports: ZodObject, ZodString, ZodNumber, ZodBoolean, ZodArray, ZodOptional,
 * ZodNullable, ZodEnum, ZodLiteral, ZodDefault.
 *
 * IMPORTANT: This is intentionally minimal — covers only the tool input schemas
 * defined in this codebase. Do not expand without a test.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals require any traversal
function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def as any;

  switch (def.typeName) {
    case 'ZodString': {
      const node: { type: 'string'; description?: string } = { type: 'string' };
      if (def.description) node.description = def.description;
      return node;
    }
    case 'ZodNumber':
    case 'ZodInt': {
      const node: { type: 'integer'; description?: string; minimum?: number; maximum?: number } = {
        type: 'integer',
      };
      if (def.description) node.description = def.description;
      // Extract min/max from ZodNumber checks
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') node.minimum = check.value;
        if (check.kind === 'max') node.maximum = check.value;
      }
      return node;
    }
    case 'ZodBoolean': {
      return { type: 'boolean' };
    }
    case 'ZodEnum': {
      return { type: 'string', enum: def.values as string[] };
    }
    case 'ZodLiteral': {
      return { type: 'string', enum: [String(def.value)] };
    }
    case 'ZodArray': {
      return { type: 'array', items: zodToJsonSchema(def.type as z.ZodTypeAny) };
    }
    case 'ZodOptional':
    case 'ZodDefault': {
      // Unwrap optional/default and convert the inner type
      return zodToJsonSchema(def.innerType as z.ZodTypeAny);
    }
    case 'ZodNullable': {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { anyOf: [inner, { type: 'string', enum: ['null'] }] } as JsonSchemaNode;
    }
    case 'ZodObject': {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, JsonSchemaNode> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fieldDef = (value as any)._def as any;
        properties[key] = zodToJsonSchema(value);
        // Required = not ZodOptional and not ZodDefault
        if (
          fieldDef.typeName !== 'ZodOptional' &&
          fieldDef.typeName !== 'ZodDefault'
        ) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    default: {
      // Fallback: unknown type → no constraint
      return {};
    }
  }
}

// ---------------------------------------------------------------------------
// defineTool — public factory

/**
 * Create a typed tool definition.
 *
 * @param name         MCP tool name (e.g. "wiki.search")
 * @param description  Shown to Claude at initialize
 * @param inputSchema  Zod schema for input validation
 * @param handler      Async function receiving validated input, returning output
 *
 * @returns ToolDefinition with MCP SDK-compatible descriptors
 *
 * Usage in server.ts:
 *   const wikiSearch = defineTool({ name: 'wiki.search', description: '...', inputSchema: WikiSearchInputSchema, handler: async (input) => ... })
 *   server.setRequestHandler(CallToolRequestSchema, wikiSearch.mcpHandler)
 */
export function defineTool<TInput extends z.ZodTypeAny>({
  name,
  description,
  inputSchema,
  handler,
}: {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}): ToolDefinition<TInput> {
  // Derive JSON Schema for MCP client tooling
  const inputJsonSchema = zodToJsonSchema(inputSchema) as {
    type: 'object';
    properties: Record<string, JsonSchemaNode>;
    required?: string[];
  };

  const mcpTool: Tool = {
    name,
    description,
    inputSchema: inputJsonSchema,
  };

  // Adapter: validate input with Zod, call handler, wrap output
  const mcpHandler = async (args: unknown): Promise<CallToolResult> => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              code: 'invalid_input',
              errors: parsed.error.errors,
            }),
          },
        ],
      };
    }

    try {
      const result = await handler(parsed.data as z.infer<TInput>);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (err) {
      // Re-throw McpError so SDK can format it as a protocol error
      throw err;
    }
  };

  return { name, description, inputSchema, handler, mcpTool, mcpHandler };
}
