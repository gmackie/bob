import { createHash, randomBytes } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "@linear-clone/db";
import { apiKeys, users, type User } from "@linear-clone/db";

const API_KEY_PREFIX = "lc_";

export interface ApiKeyValidation {
  valid: boolean;
  user?: User;
  scopes?: string[];
  error?: string;
}

/**
 * Generate a new API key
 * Returns the raw key (only shown once) and the key metadata
 */
export async function generateApiKey(
  db: Database,
  userId: string,
  name: string,
  scopes: string[] = ["read"],
  expiresAt?: Date
) {
  // Generate a secure random key
  const rawKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 8);

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      userId,
      name,
      keyHash,
      keyPrefix,
      scopes,
      expiresAt,
    })
    .returning();

  return {
    id: apiKey!.id,
    rawKey, // Only returned once!
    name: apiKey!.name,
    keyPrefix,
    scopes,
    expiresAt: apiKey!.expiresAt,
    createdAt: apiKey!.createdAt,
  };
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate an API key and return the associated user
 */
export async function validateApiKey(
  db: Database,
  key: string
): Promise<ApiKeyValidation> {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: "Invalid API key format" };
  }

  const keyHash = hashApiKey(key);

  const [result] = await db
    .select({
      apiKey: apiKeys,
      user: users,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        isNull(apiKeys.revokedAt)
      )
    )
    .limit(1);

  if (!result) {
    return { valid: false, error: "Invalid or revoked API key" };
  }

  // Check expiration
  if (result.apiKey.expiresAt && result.apiKey.expiresAt < new Date()) {
    return { valid: false, error: "API key has expired" };
  }

  // Update last used timestamp (don't await to avoid slowing down requests)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, result.apiKey.id))
    .then(() => {})
    .catch(() => {});

  return {
    valid: true,
    user: result.user,
    scopes: result.apiKey.scopes as string[],
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  db: Database,
  keyId: string,
  userId: string
): Promise<boolean> {
  const [result] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();

  return !!result;
}

/**
 * List all API keys for a user (without the actual key values)
 */
export async function listApiKeys(db: Database, userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}
