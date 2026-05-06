/**
 * tool-definitions.ts — Anthropic SDK Tool definition objects for the agent loop
 *
 * Extracted from agent-loop.ts to keep that file under 200 LOC.
 * These are the JSON schema descriptors registered with the Anthropic SDK;
 * they contain NO behavioral prose — that lives in prompts/v1.md.
 *
 * Tool names per phase-06 anti-trace renaming map (ADR 010/012):
 *   listCatalog | searchNotes | readNote | excerptMaterial | upsertNote | linkNotes | complete
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'listCatalog',
    description: 'Read the current __catalog index page listing all existing notes in this KB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string', description: 'Workspace UUID' },
        kbId: { type: 'string', description: 'Knowledge base UUID' },
      },
      required: ['workspaceId', 'kbId'],
    },
  },
  {
    name: 'searchNotes',
    description: 'Semantic search over compiled notes. Returns top-K most relevant notes with excerpts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string' },
        kbId: { type: 'string' },
        query: { type: 'string', description: 'Natural language search query' },
        topK: { type: 'number', description: 'Number of results (1-20, default 5)' },
      },
      required: ['workspaceId', 'kbId', 'query'],
    },
  },
  {
    name: 'readNote',
    description: 'Fetch full content of an existing note by slug.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string' },
        kbId: { type: 'string' },
        slug: { type: 'string', description: 'Note slug (kebab-case, max 40 chars)' },
      },
      required: ['workspaceId', 'kbId', 'slug'],
    },
  },
  {
    name: 'excerptMaterial',
    description: 'Read a windowed slice of the source material text. Content is wrapped in <material> XML delimiters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string' },
        materialId: { type: 'string', description: 'Material UUID' },
        charOffset: { type: 'number', description: 'Character offset to start reading (default 0)' },
        charCount: { type: 'number', description: 'Characters to return (max 20000)' },
      },
      required: ['workspaceId', 'materialId'],
    },
  },
  {
    name: 'upsertNote',
    description: 'Create or update a wiki note page. Assigns taxonomy (fact|analysis|procedure|reference).',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string' },
        kbId: { type: 'string' },
        slug: { type: 'string', description: 'Note slug (kebab-case, max 40 chars)' },
        title: { type: 'string', description: 'Human-readable title (max 255 chars)' },
        content: { type: 'string', description: 'Full markdown content of the note' },
        taxonomy: {
          type: 'string',
          enum: ['fact', 'analysis', 'procedure', 'reference'],
          description: 'Page taxonomy per ADR 010',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag labels' },
      },
      required: ['workspaceId', 'kbId', 'slug', 'title', 'content', 'taxonomy'],
    },
  },
  {
    name: 'linkNotes',
    description: 'Create a cross-reference link from one note to another.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspaceId: { type: 'string' },
        kbId: { type: 'string' },
        fromSlug: { type: 'string', description: 'Source note slug' },
        toSlug: { type: 'string', description: 'Target note slug' },
        linkText: { type: 'string', description: 'Optional display text for the link' },
      },
      required: ['workspaceId', 'kbId', 'fromSlug', 'toSlug'],
    },
  },
  {
    name: 'complete',
    description: 'Signal that wiki compilation is finished. Call this when all notes are written.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'What was accomplished this run (max 2000 chars)' },
        notesCreated: { type: 'array', items: { type: 'string' }, description: 'Slugs of created notes' },
        notesUpdated: { type: 'array', items: { type: 'string' }, description: 'Slugs of updated notes' },
        linksCreated: { type: 'number', description: 'Number of cross-reference links created' },
      },
      required: ['summary'],
    },
  },
];
