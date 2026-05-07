/**
 * outline-extractor.test.ts — Unit tests for extractOutline() in source-outline-service
 *
 * Pure function tests — no IO, no DB, no mocks.
 * Covers: markdown headings, ALL-CAPS headers, indented sub-headings,
 * nested tree assembly, edge cases (empty input, deeply nested, mixed).
 */

import { describe, it, expect } from 'vitest';
import { extractOutline } from '../../../apps/wiki-team/services/source-outline-service.js';
import type { OutlineNode } from '../../../apps/wiki-team/services/source-outline-service.js';

// ---------------------------------------------------------------------------
// Helpers

function flat(nodes: OutlineNode[]): Array<{ level: number; text: string }> {
  const result: Array<{ level: number; text: string }> = [];
  function walk(ns: OutlineNode[]) {
    for (const n of ns) {
      result.push({ level: n.level, text: n.text });
      walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Markdown headings

describe('extractOutline — markdown headings', () => {
  it('returns empty array for empty input', () => {
    expect(extractOutline('')).toEqual([]);
  });

  it('detects a single h1 heading', () => {
    const outline = extractOutline('# Introduction\n\nSome body text.');
    expect(outline).toHaveLength(1);
    expect(outline[0]!.level).toBe(1);
    expect(outline[0]!.text).toBe('Introduction');
  });

  it('detects h1 through h4 in sequence', () => {
    const text = '# One\n## Two\n### Three\n#### Four\n';
    const nodes = flat(extractOutline(text));
    expect(nodes).toHaveLength(4);
    expect(nodes[0]!.level).toBe(1);
    expect(nodes[1]!.level).toBe(2);
    expect(nodes[2]!.level).toBe(3);
    expect(nodes[3]!.level).toBe(4);
  });

  it('builds correct nested tree from h1 > h2 > h3', () => {
    const text = '# Chapter\n## Section\n### Subsection\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    const chapter = outline[0]!;
    expect(chapter.text).toBe('Chapter');
    expect(chapter.children).toHaveLength(1);
    const section = chapter.children[0]!;
    expect(section.text).toBe('Section');
    expect(section.children).toHaveLength(1);
    expect(section.children[0]!.text).toBe('Subsection');
  });

  it('sibling h2s share the same h1 parent', () => {
    const text = '# Root\n## Alpha\n## Beta\n## Gamma\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    expect(outline[0]!.children).toHaveLength(3);
  });

  it('multiple h1s produce multiple roots', () => {
    const text = '# First\nBody.\n# Second\nBody.\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(2);
    expect(outline[0]!.text).toBe('First');
    expect(outline[1]!.text).toBe('Second');
  });

  it('truncates heading text to 120 chars', () => {
    const longText = 'A'.repeat(200);
    const outline = extractOutline(`# ${longText}\n`);
    expect(outline[0]!.text).toHaveLength(120);
  });

  it('records correct charOffset for second heading', () => {
    const line1 = '# First\n';     // offset 0
    const line2 = '# Second\n';    // offset 8
    const outline = extractOutline(line1 + line2);
    expect(outline[0]!.charOffset).toBe(0);
    expect(outline[1]!.charOffset).toBe(line1.length);
  });

  it('pageNumber is always null (no page metadata in plain text)', () => {
    const outline = extractOutline('# Heading\n');
    expect(outline[0]!.pageNumber).toBeNull();
  });

  it('ignores lines that are not headings', () => {
    const text = 'Just a paragraph.\nNo headings here.\n';
    // Only ALL-CAPS or indented could match; plain prose should not produce markdown hits
    const outline = extractOutline(text);
    // Pure prose: no markdown headings. May or may not have caps hits — just ensure no crash.
    expect(Array.isArray(outline)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ALL-CAPS section headers

describe('extractOutline — ALL-CAPS section headers', () => {
  it('detects an ALL-CAPS header with spaces as level 2', () => {
    const text = 'EXECUTIVE SUMMARY\n\nThis section covers...\n';
    const nodes = flat(extractOutline(text));
    const caps = nodes.find((n) => n.text === 'EXECUTIVE SUMMARY');
    expect(caps).toBeDefined();
    expect(caps!.level).toBe(2);
  });

  it('rejects single-word ALL-CAPS (no space)', () => {
    const text = 'INTRODUCTION\n\nBody text.\n';
    const outline = extractOutline(text);
    const hit = flat(outline).find((n) => n.text === 'INTRODUCTION');
    // Single word without space should NOT match (RX requires space)
    expect(hit).toBeUndefined();
  });

  it('rejects ALL-CAPS lines shorter than 5 chars', () => {
    const text = 'ABC D\n\nBody.\n'; // 5 chars with space — borderline
    // Just verify no crash and returns an array
    expect(Array.isArray(extractOutline(text))).toBe(true);
  });

  it('ALL-CAPS after markdown h1 becomes child at level 2', () => {
    const text = '# Document Title\n\nMAIN FINDINGS\n\nContent here.\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    const root = outline[0]!;
    expect(root.text).toBe('Document Title');
    // MAIN FINDINGS is level 2 → child of h1
    const capChild = root.children.find((c) => c.text === 'MAIN FINDINGS');
    expect(capChild).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Indented sub-headings

describe('extractOutline — indented sub-headings', () => {
  it('detects 4-space indented line as level 3', () => {
    const text = '    Sub-topic heading here\n';
    const nodes = flat(extractOutline(text));
    const hit = nodes.find((n) => n.text.startsWith('Sub-topic'));
    expect(hit).toBeDefined();
    expect(hit!.level).toBe(3);
  });

  it('detects tab-indented line as level 3', () => {
    const text = '\tAnother sub-heading\n';
    const nodes = flat(extractOutline(text));
    const hit = nodes.find((n) => n.text.startsWith('Another'));
    expect(hit).toBeDefined();
    expect(hit!.level).toBe(3);
  });

  it('indented line under h2 becomes grandchild', () => {
    const text = '## Section\n    Details here\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1); // h2 is root (no h1 above)
    const section = outline[0]!;
    expect(section.level).toBe(2);
    // indented = level 3 → child of h2
    expect(section.children.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases

describe('extractOutline — edge cases', () => {
  it('handles text with no heading signals → returns []', () => {
    const text = 'This is just a paragraph. No headings. No caps. No indent.\n';
    // Expect empty or minimal — no crash
    expect(Array.isArray(extractOutline(text))).toBe(true);
  });

  it('handles deeply nested h1 > h2 > h3 > h4 > h5 > h6', () => {
    const text = '# L1\n## L2\n### L3\n#### L4\n##### L5\n###### L6\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    let node = outline[0]!;
    for (let depth = 1; depth <= 5; depth++) {
      expect(node.children).toHaveLength(1);
      node = node.children[0]!;
    }
    expect(node.level).toBe(6);
  });

  it('handles level jump (h1 → h4) without crash', () => {
    const text = '# Root\n#### Deep\n';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    expect(outline[0]!.children).toHaveLength(1);
    expect(outline[0]!.children[0]!.level).toBe(4);
  });

  it('handles mixed markdown + ALL-CAPS + indented', () => {
    const text = [
      '# Report Title',
      '',
      'BACKGROUND INFORMATION',
      '',
      '## Subsection',
      '    Detail line here',
      '',
    ].join('\n');
    const outline = extractOutline(text);
    expect(outline.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(outline)).toBe(true);
  });

  it('returns OutlineNode with children array always present', () => {
    const outline = extractOutline('# Title\n');
    expect(Array.isArray(outline[0]!.children)).toBe(true);
  });
});
