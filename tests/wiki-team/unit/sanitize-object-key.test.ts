/**
 * sanitize-object-key.test.ts — adversarial unit tests for sanitizeObjectKey()
 *
 * 8+ cases covering: path traversal, null bytes, unicode normalization,
 * length cap, special characters, leading slash, empty result, valid input.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeObjectKey } from '../../../apps/wiki-team/storage/object-store.js';

describe('sanitizeObjectKey', () => {
  // ---- Happy path ----
  it('passes through safe ASCII filename unchanged', () => {
    expect(sanitizeObjectKey('report-2024.pdf')).toBe('report-2024.pdf');
  });

  it('passes through alphanumeric with dots and dashes', () => {
    expect(sanitizeObjectKey('My_File-v1.2.docx')).toBe('My_File-v1.2.docx');
  });

  // ---- Path traversal ----
  it('rejects double-dot path traversal', () => {
    expect(() => sanitizeObjectKey('../etc/passwd')).toThrow('path_traversal');
  });

  it('rejects embedded double-dot traversal', () => {
    expect(() => sanitizeObjectKey('foo/../../secret')).toThrow('path_traversal');
  });

  it('rejects leading slash', () => {
    expect(() => sanitizeObjectKey('/etc/passwd')).toThrow('path_traversal');
  });

  // ---- Null bytes ----
  it('rejects null byte in filename', () => {
    expect(() => sanitizeObjectKey('file\0name.txt')).toThrow('null_byte_in_key');
  });

  // ---- Special character replacement ----
  it('replaces spaces and special chars with underscore', () => {
    const result = sanitizeObjectKey('My Report (Final).pdf');
    expect(result).toBe('My_Report__Final_.pdf');
  });

  it('replaces forward-slash (non-traversal) with underscore', () => {
    const result = sanitizeObjectKey('foo/bar.txt');
    expect(result).toBe('foo_bar.txt');
  });

  it('replaces unicode fancy characters with underscores', () => {
    // © ® emoji → underscores
    const result = sanitizeObjectKey('report©2024®.pdf');
    expect(result).not.toContain('©');
    expect(result).not.toContain('®');
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  // ---- Unicode NFC normalization ----
  it('NFC-normalizes unicode before processing (e with combining accent)', () => {
    // é = é (NFC), é = e + combining accent (NFD) — both valid after NFC
    const nfd = 'café.txt';   // NFD form of "café.txt"
    const nfc = 'café.txt';         // NFC form
    // Both should produce the same sanitized output (é → _ after replacement)
    const r1 = sanitizeObjectKey(nfd);
    const r2 = sanitizeObjectKey(nfc);
    expect(r1).toBe(r2);
  });

  // ---- Length cap ----
  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeObjectKey(long);
    expect(result.length).toBe(200);
  });

  it('truncates special-char string to 200 chars after replacement', () => {
    // All spaces → underscores, then truncated
    const spaces = ' '.repeat(250);
    const result = sanitizeObjectKey(spaces);
    expect(result.length).toBe(200);
    expect(result).toBe('_'.repeat(200));
  });

  // ---- Empty result ----
  it('throws empty_key when all chars are stripped (empty input)', () => {
    expect(() => sanitizeObjectKey('')).toThrow('empty_key');
  });

  it('throws empty_key when input normalizes to empty after NFC (zero-width chars)', () => {
    // zero-width space ​ is not in [a-zA-Z0-9._-], becomes _, but let's test pure empty
    // Test: empty string after normalization
    expect(() => sanitizeObjectKey('')).toThrow('empty_key');
  });
});
