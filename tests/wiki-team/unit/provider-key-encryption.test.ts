/**
 * provider-key-encryption.test.ts — unit tests for HKDF + AES-GCM-256 key encryption.
 *
 * Tests: encrypt+decrypt roundtrip, salt uniqueness (different workspace → different key),
 * rotation (same workspace, different epoch → different ciphertext), error cases.
 *
 * Runs without DB/Redis — pure crypto only.
 * Requires BETTER_AUTH_SECRET env var (set to test value below).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  type EncryptionMetadata,
} from '../../../apps/wiki-team/services/provider-key-encryption.js';

// Set test secret before importing module
const TEST_SECRET = 'test-secret-at-least-32-chars-long!!';
const WS_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const WS_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const TEST_KEY = 'sk-test-api-key-1234567890';

beforeAll(() => {
  process.env['BETTER_AUTH_SECRET'] = TEST_SECRET;
});

afterAll(() => {
  delete process.env['BETTER_AUTH_SECRET'];
});

// ---------------------------------------------------------------------------
// Happy-path: roundtrip

describe('encryptApiKey / decryptApiKey — roundtrip', () => {
  it('encrypts and decrypts correctly (epoch 0)', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 0);
    expect(ciphertextHex).toBeTruthy();
    expect(metadata.rotationEpoch).toBe(0);
    expect(metadata.info).toBe('provider-api-key-v1');

    const plaintext = await decryptApiKey(ciphertextHex, metadata, WS_A);
    expect(plaintext).toBe(TEST_KEY);
  });

  it('encrypts and decrypts correctly (epoch 5)', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 5);
    const plaintext = await decryptApiKey(ciphertextHex, metadata, WS_A);
    expect(plaintext).toBe(TEST_KEY);
  });

  it('ciphertext is hex-encoded (even length, hex chars only)', async () => {
    const { ciphertextHex } = await encryptApiKey(TEST_KEY, WS_A, 0);
    expect(ciphertextHex.length % 2).toBe(0);
    expect(ciphertextHex).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// Salt uniqueness: different workspace → different key → different ciphertext

describe('salt uniqueness', () => {
  it('produces different ciphertexts for different workspaces (same plaintext, same epoch)', async () => {
    const { ciphertextHex: ctA } = await encryptApiKey(TEST_KEY, WS_A, 0);
    const { ciphertextHex: ctB } = await encryptApiKey(TEST_KEY, WS_B, 0);
    expect(ctA).not.toBe(ctB);
  });

  it('workspace A ciphertext cannot be decrypted with workspace B', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 0);
    await expect(decryptApiKey(ciphertextHex, metadata, WS_B)).rejects.toThrow('decryption failed');
  });

  it('produces different IV on each encrypt call (random IV)', async () => {
    const { metadata: m1 } = await encryptApiKey(TEST_KEY, WS_A, 0);
    const { metadata: m2 } = await encryptApiKey(TEST_KEY, WS_A, 0);
    expect(m1.ivHex).not.toBe(m2.ivHex);
  });
});

// ---------------------------------------------------------------------------
// Rotation: different epoch → different derived key → different ciphertext

describe('rotation (secretRotationEpoch)', () => {
  it('epoch 0 and epoch 1 produce different ciphertexts', async () => {
    const { ciphertextHex: ct0 } = await encryptApiKey(TEST_KEY, WS_A, 0);
    const { ciphertextHex: ct1 } = await encryptApiKey(TEST_KEY, WS_A, 1);
    expect(ct0).not.toBe(ct1);
  });

  it('epoch 1 ciphertext decrypts with epoch 1 metadata', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 1);
    const plaintext = await decryptApiKey(ciphertextHex, metadata, WS_A);
    expect(plaintext).toBe(TEST_KEY);
  });

  it('epoch 1 ciphertext fails decryption when metadata epoch is 0', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 1);
    const tampered: EncryptionMetadata = { ...metadata, rotationEpoch: 0 };
    await expect(decryptApiKey(ciphertextHex, tampered, WS_A)).rejects.toThrow('decryption failed');
  });
});

// ---------------------------------------------------------------------------
// Error cases

describe('input validation', () => {
  it('encryptApiKey throws on empty plaintext', async () => {
    await expect(encryptApiKey('', WS_A, 0)).rejects.toThrow('non-empty');
  });

  it('encryptApiKey throws on empty workspaceId', async () => {
    await expect(encryptApiKey(TEST_KEY, '', 0)).rejects.toThrow('non-empty');
  });

  it('encryptApiKey throws on negative rotationEpoch', async () => {
    await expect(encryptApiKey(TEST_KEY, WS_A, -1)).rejects.toThrow('non-negative');
  });

  it('decryptApiKey throws on empty ciphertextHex', async () => {
    const { metadata } = await encryptApiKey(TEST_KEY, WS_A, 0);
    await expect(decryptApiKey('', metadata, WS_A)).rejects.toThrow('required');
  });

  it('decryptApiKey throws on tampered ciphertext', async () => {
    const { ciphertextHex, metadata } = await encryptApiKey(TEST_KEY, WS_A, 0);
    const tampered = ciphertextHex.slice(0, -4) + 'dead';
    await expect(decryptApiKey(tampered, metadata, WS_A)).rejects.toThrow('decryption failed');
  });

  it('throws when BETTER_AUTH_SECRET is missing', async () => {
    const saved = process.env['BETTER_AUTH_SECRET'];
    delete process.env['BETTER_AUTH_SECRET'];
    await expect(encryptApiKey(TEST_KEY, WS_A, 0)).rejects.toThrow('BETTER_AUTH_SECRET');
    process.env['BETTER_AUTH_SECRET'] = saved;
  });
});
