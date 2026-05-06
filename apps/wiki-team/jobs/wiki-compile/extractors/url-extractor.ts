/**
 * url-extractor.ts — Web page text extraction via fetch + @mozilla/readability
 *
 * Fetches a URL, parses the DOM with jsdom, then runs Readability to extract
 * the main article text. This strips nav/footer/ads and returns clean prose.
 *
 * Dependencies: @mozilla/readability (MIT), jsdom (MIT)
 * No AGPL concern.
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ExtractedMaterial } from './pdf-extractor.js';

// Shared cap — own value per phase-06 spec
const MATERIAL_CHARS_CAP = 150_000;

// Fetch timeout: 30s — reasonable for public web pages
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// extractFromUrl

/**
 * Fetch a URL and extract its main article text using Readability.
 *
 * Uses global `fetch` (Node 18+ / Bun built-in). Falls back to full body text
 * if Readability cannot identify a main content region.
 *
 * @param url   Fully-qualified HTTP/HTTPS URL string.
 * @returns     Normalised ExtractedMaterial.
 * @throws      On network error, non-2xx response, or non-HTML content type.
 */
export async function extractFromUrl(url: string): Promise<ExtractedMaterial> {
  // Validate URL before fetch to avoid cryptic network errors
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`[url-extractor] Invalid URL: "${url}"`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`[url-extractor] Only http/https URLs are supported (got: ${parsedUrl.protocol})`);
  }

  // Abort controller for timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Identify as a bot — respectful default; callers may override if needed
        'User-Agent': 'wiki-team/2.0 (content-indexer; +internal)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`[url-extractor] Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw new Error(
      `[url-extractor] Network error fetching "${url}": ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `[url-extractor] HTTP ${response.status} ${response.statusText} for "${url}"`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(
      `[url-extractor] Unsupported content-type "${contentType}" for "${url}". Expected HTML.`,
    );
  }

  const html = await response.text();

  // Parse with jsdom — Readability requires a DOM
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  // Fall back to full body text if Readability yields nothing
  const raw = article?.textContent?.trim()
    ?? dom.window.document.body?.textContent?.trim()
    ?? '';

  if (raw.length === 0) {
    throw new Error(`[url-extractor] No readable text content found at "${url}"`);
  }

  const truncated = raw.length > MATERIAL_CHARS_CAP;
  const text = truncated ? raw.slice(0, MATERIAL_CHARS_CAP) : raw;

  return {
    text,
    truncated,
    sourceSizeBytes: Buffer.byteLength(html, 'utf8'),
  };
}
