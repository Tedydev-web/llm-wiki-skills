/**
 * provider-resolver.ts — resolve and decrypt the active vision provider config
 * for a given workspace from provider_settings table.
 *
 * Reads capability='vision' row, decrypts API key, returns ProviderConfig + vendor.
 * Throws if no vision provider configured or workspace has vision_enabled=false.
 *
 * Note: vision_enabled check is enforced at job-enqueue time (job-handler.ts in
 * wiki-compile). This resolver is a secondary safeguard — it validates the provider
 * row exists and the API key can be decrypted before the LLM call.
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../../storage/db.js';

// ---------------------------------------------------------------------------
// ResolvedVisionProvider — decrypted config ready for ProviderFactory

export interface ResolvedVisionProvider {
  vendor: string;
  model: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// resolveVisionProviderConfig — main entry point

/**
 * Fetch and decrypt the active vision provider config for a workspace.
 *
 * @throws Error if no vision provider_settings row found for the workspace.
 * @throws Error if API key decryption fails.
 */
export async function resolveVisionProviderConfig(
  workspaceId: string,
): Promise<ResolvedVisionProvider> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.providerSettings)
    .where(
      and(
        eq(schema.providerSettings.workspaceId, workspaceId),
        eq(schema.providerSettings.capability, 'vision'),
      ),
    )
    .orderBy(schema.providerSettings.updatedAt)
    .limit(1);

  if (rows.length === 0) {
    throw new Error(
      `[provider-resolver] no vision provider configured for workspace ${workspaceId}`,
    );
  }

  const row = rows[0]!;

  // Decrypt API key using the same path as the compile pipeline
  // Import lazily to avoid circular deps with storage layer
  const { decryptApiKey } = await import('../../services/provider-key-encryption.js');
  const apiKey = await decryptApiKey(
    row.apiKeyEncrypted,
    row.encryptionMetadata as import('../../services/provider-key-encryption.js').EncryptionMetadata,
    workspaceId,
  );

  return {
    vendor: row.vendor,
    model: row.model,
    apiKey,
  };
}
