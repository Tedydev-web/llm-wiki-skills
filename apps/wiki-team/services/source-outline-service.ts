/**
 * source-outline-service.ts — Heading-based outline extraction from material text
 *
 * Pure, side-effect-free parser. No DB or IO dependencies.
 * Detects three heading signal types (in priority order):
 *   1. Markdown headings: /^#{1,6}\s+(.+)$/
 *   2. ALL-CAPS section headers: 5–41 chars, letter-dominant, alone on a line
 *   3. Indented sub-headings: lines starting with \t or 4+ spaces (treated as level 3)
 *
 * Output: nested OutlineNode tree assembled by level.
 *
 * Anti-trace: own type names and function names throughout.
 */

// ---------------------------------------------------------------------------
// Types

export interface OutlineNode {
  /** Heading depth 1–6 (1 = top-level) */
  level: number;
  /** Heading text, trimmed, ≤ 120 chars */
  text: string;
  /** Character offset of the heading line start in the source text */
  charOffset: number;
  /** PDF page number if available from extraction metadata; null otherwise */
  pageNumber: number | null;
  /** Children nested at deeper levels */
  children: OutlineNode[];
}

// ---------------------------------------------------------------------------
// Regex patterns

/** Markdown ATX heading: # through ###### followed by space + text */
const RX_MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;

/**
 * ALL-CAPS section header heuristic:
 * - 5–41 chars (avoids single-word acronyms and overly long lines)
 * - Starts with a capital letter
 * - Only uppercase letters, spaces, digits, and limited punctuation
 * - Must contain at least one space (eliminates single-word acronyms like "API")
 */
const RX_ALLCAPS_HEADER = /^([A-Z][A-Z0-9\s,.:/-]{4,40})$/;

/** Indented line: tab or 4+ leading spaces */
const RX_INDENTED = /^(?:\t| {4,})\S/;

// ---------------------------------------------------------------------------
// Internal flat candidate type before tree assembly

interface HeadingCandidate {
  level: number;
  text: string;
  charOffset: number;
  pageNumber: null;
}

// ---------------------------------------------------------------------------
// detectHeadings — 2-pass scan: collect + classify, then deduplicate adjacent

function detectHeadings(text: string): HeadingCandidate[] {
  const lines = text.split('\n');
  const candidates: HeadingCandidate[] = [];
  let offset = 0;

  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for the \n consumed by split

    // Priority 1: Markdown heading
    const mdMatch = RX_MARKDOWN_HEADING.exec(line);
    if (mdMatch) {
      const raw = mdMatch[2]!.trim().slice(0, 120);
      if (raw.length > 0) {
        candidates.push({
          level: mdMatch[1]!.length,
          text: raw,
          charOffset: offset,
          pageNumber: null,
        });
        offset += lineLen;
        continue;
      }
    }

    // Priority 2: ALL-CAPS section header (level 2, below top-level markdown)
    const capsMatch = RX_ALLCAPS_HEADER.exec(line.trim());
    if (capsMatch && line.trim().includes(' ')) {
      const raw = capsMatch[1]!.trim().slice(0, 120);
      candidates.push({
        level: 2,
        text: raw,
        charOffset: offset,
        pageNumber: null,
      });
      offset += lineLen;
      continue;
    }

    // Priority 3: Indented line (level 3 — sub-heading heuristic)
    if (RX_INDENTED.test(line)) {
      const raw = line.trim().slice(0, 120);
      if (raw.length >= 4 && raw.length <= 120) {
        candidates.push({
          level: 3,
          text: raw,
          charOffset: offset,
          pageNumber: null,
        });
      }
    }

    offset += lineLen;
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// buildOutlineTree — convert flat candidates into nested OutlineNode tree
//
// Algorithm: stack-based. Stack tracks the path from root to current node.
// Each new candidate pops the stack until the top level < candidate level,
// then appends the new node as a child.

function buildOutlineTree(candidates: HeadingCandidate[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // Stack entries: [node, level]
  const stack: Array<{ node: OutlineNode; level: number }> = [];

  for (const c of candidates) {
    const node: OutlineNode = {
      level: c.level,
      text: c.text,
      charOffset: c.charOffset,
      pageNumber: c.pageNumber,
      children: [],
    };

    // Pop stack entries whose level >= current (current is deeper sibling or higher level)
    while (stack.length > 0 && stack[stack.length - 1]!.level >= c.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // No parent — this is a root node
      roots.push(node);
    } else {
      // Attach as child of current stack top
      stack[stack.length - 1]!.node.children.push(node);
    }

    stack.push({ node, level: c.level });
  }

  return roots;
}

// ---------------------------------------------------------------------------
// extractOutline — public API: text → nested OutlineNode[]
//
// Pure function. Deterministic. No IO.

export function extractOutline(text: string): OutlineNode[] {
  if (!text || text.length === 0) return [];
  const candidates = detectHeadings(text);
  return buildOutlineTree(candidates);
}
