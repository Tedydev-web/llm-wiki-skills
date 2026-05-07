/**
 * provider-key-encryption.ts — AES-GCM-256 API key encryption via HKDF.
 *
 * ADR 013 §API key encryption:
 *   key = HKDF(IKM=BETTER_AUTH_SECRET, salt=workspaceId_bytes||uint32BE(epoch),
 *              info="provider-api-key-v1", len=32)
 *   ciphertext = AES-GCM-256.encrypt(key, iv=crypto.randomBytes(12), plaintext)
 *
 * Per-row salt prevents multi-target attacks.
 * rotationEpoch enables key rotation: bump epoch → new rows use new derived key;
 * old rows remain readable until re-encrypted asynchronously (see ADR 013 §rotation).
 *
 * Uses Web Crypto API (crypto.subtle) — available in Node 18+, Bun, browsers.
 * No third-party crypto dependency.
 */

// ---------------------------------------------------------------------------
// Types

export interface EncryptionMetadata {
  /** Hex-encoded salt = workspaceId bytes || uint32BE(rotationEpoch) */
  saltHex: string;
  /** Hex-encoded AES-GCM IV (12 bytes) */
  ivHex: string;
  /** Epoch used for HKDF salt derivation — enables rotation detection */
  rotationEpoch: number;
  /** Info string used in HKDF — versioned for future algorithm upgrades */
  info: string;
}

export interface EncryptResult {
  /** Hex-encoded AES-GCM ciphertext (includes 16-byte auth tag appended by SubtleCrypto) */
  ciphertextHex: string;
  metadata: EncryptionMetadata;
}

// ---------------------------------------------------------------------------
// Environment helper

function getMasterSecret(): Uint8Array {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret || secret.trim() === '') {
    throw new Error('[provider-key-encryption] BETTER_AUTH_SECRET env var is missing or empty');
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// HKDF key derivation

/**
 * Derives a 256-bit AES-GCM key using HKDF-SHA256.
 * salt = workspaceId UTF-8 bytes || uint32BE(rotationEpoch)
 * info = "provider-api-key-v1"
 */
async function deriveKey(
  workspaceId: string,
  rotationEpoch: number,
): Promise<{ cryptoKey: CryptoKey; saltHex: string }> {
  const ikm = getMasterSecret();

  // Build per-row salt: workspaceId bytes + 4-byte big-endian epoch
  const wsBytes = new TextEncoder().encode(workspaceId);
  const epochBytes = new Uint8Array(4);
  new DataView(epochBytes.buffer).setUint32(0, rotationEpoch, false); // big-endian
  const salt = new Uint8Array(wsBytes.length + 4);
  salt.set(wsBytes, 0);
  salt.set(epochBytes, wsBytes.length);

  const saltHex = Buffer.from(salt).toString('hex');
  const info = new TextEncoder().encode('provider-api-key-v1');

  // Import IKM as raw key material.
  // SubtleCrypto importKey expects BufferSource = ArrayBuffer | ArrayBufferView<ArrayBuffer>.
  // TextEncoder().encode() returns Uint8Array<ArrayBufferLike> in TS 5.7+, which is not
  // assignable. We copy into a typed ArrayBuffer to satisfy the strict overload.
  const ikmBuf: ArrayBuffer = ikm.buffer instanceof ArrayBuffer
    ? ikm.buffer.slice(ikm.byteOffset, ikm.byteOffset + ikm.byteLength) as ArrayBuffer
    : (() => { const b = new ArrayBuffer(ikm.byteLength); new Uint8Array(b).set(ikm); return b; })();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    ikmBuf,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  // Derive AES-GCM-256 key
  const cryptoKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return { cryptoKey, saltHex };
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Encrypts a plaintext API key for a given workspace.
 *
 * @param plaintext     The raw API key string (e.g. "sk-...")
 * @param workspaceId   UUID of the owning workspace (used in HKDF salt)
 * @param rotationEpoch Non-negative integer; increment to rotate keys
 * @returns             Hex ciphertext + metadata for storage
 */
export async function encryptApiKey(
  plaintext: string,
  workspaceId: string,
  rotationEpoch: number = 0,
): Promise<EncryptResult> {
  if (!plaintext || plaintext.trim() === '') {
    throw new Error('encryptApiKey: plaintext must be a non-empty string');
  }
  if (!workspaceId || workspaceId.trim() === '') {
    throw new Error('encryptApiKey: workspaceId must be a non-empty string');
  }
  if (!Number.isInteger(rotationEpoch) || rotationEpoch < 0) {
    throw new Error('encryptApiKey: rotationEpoch must be a non-negative integer');
  }

  const { cryptoKey, saltHex } = await deriveKey(workspaceId, rotationEpoch);

  // Random 12-byte IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintextBytes,
  );

  const ciphertextHex = Buffer.from(ciphertextBuf).toString('hex');
  const ivHex = Buffer.from(iv).toString('hex');

  return {
    ciphertextHex,
    metadata: {
      saltHex,
      ivHex,
      rotationEpoch,
      info: 'provider-api-key-v1',
    },
  };
}

/**
 * Decrypts a stored API key ciphertext using metadata for HKDF re-derivation.
 *
 * @param ciphertextHex  Hex-encoded ciphertext from encryptApiKey
 * @param metadata       EncryptionMetadata stored alongside ciphertext
 * @param workspaceId    UUID of the owning workspace (must match encryption-time value)
 * @returns              Plaintext API key string
 */
export async function decryptApiKey(
  ciphertextHex: string,
  metadata: EncryptionMetadata,
  workspaceId: string,
): Promise<string> {
  if (!ciphertextHex) throw new Error('decryptApiKey: ciphertextHex is required');
  if (!workspaceId) throw new Error('decryptApiKey: workspaceId is required');

  const { cryptoKey } = await deriveKey(workspaceId, metadata.rotationEpoch);

  const ciphertextBytes = Buffer.from(ciphertextHex, 'hex');
  const iv = Buffer.from(metadata.ivHex, 'hex');

  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertextBytes,
    );
  } catch {
    throw new Error('decryptApiKey: decryption failed — wrong key, epoch, or tampered ciphertext');
  }

  return new TextDecoder().decode(plaintextBuf);
}
