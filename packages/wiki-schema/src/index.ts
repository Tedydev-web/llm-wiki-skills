/**
 * index.ts — re-export aggregator for @wiki-team/schema
 *
 * Single entry point for all shared Zod schemas and TypeScript types.
 * Import order follows dependency graph (permission → workspace → note → material → mcp-token → …)
 */

export * from './permission.js';
export * from './workspace.js';
export * from './note.js';
export * from './material.js';
export * from './mcp-token.js';
export * from './job-status.js';
export * from './audit.js';
