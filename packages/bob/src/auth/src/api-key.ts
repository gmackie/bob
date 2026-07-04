import { createHash } from "node:crypto";

import { db } from "@bob/db/client";
import type { user } from "@bob/db/schema";
import { apiKeys } from "@bob/db/schema";

export const API_KEY_PREFIXES = ["gmk_", "bob_"] as const;

export type ApiKeyPermission = "read" | "write" | "delete" | "admin";

export interface ApiKeyAuth {
  keyId: string;
  permissions: ApiKeyPermission[];
  user: typeof user.$inferSelect;
  userId: string;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isApiKey(value: string | null | undefined): value is string {
  if (!value) return false;
  return API_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export async function validateApiKey(
  key: string,
): Promise<ApiKeyAuth | null> {
  if (!isApiKey(key)) return null;

  const keyHash = hashApiKey(key);

  const keyRecord = await db.query.apiKeys.findFirst({
    where: (table, { and, eq, isNull }) =>
      and(eq(table.keyHash, keyHash), isNull(table.revokedAt)),
  });

  if (!keyRecord) return null;
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) return null;

  const userRecord = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, keyRecord.userId),
  });

  if (!userRecord) return null;

  return {
    keyId: keyRecord.id,
    permissions: keyRecord.permissions as ApiKeyPermission[],
    user: userRecord,
    userId: keyRecord.userId,
  };
}
