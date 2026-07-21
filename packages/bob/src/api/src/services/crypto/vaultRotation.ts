/**
 * Re-encrypt vault material under the current GIT_TOKEN_ENCRYPTION_KEY.
 *
 * Rotation procedure:
 *   1. Set GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS = <old key>
 *   2. Set GIT_TOKEN_ENCRYPTION_KEY = <new key>
 *   3. Restart services
 *   4. Call rotateTokenVaultMaterial() (or run scripts/rotate-token-vault.ts)
 *   5. Once all rows re-encrypted and verified, unset PREVIOUS and restart
 *
 * Decrypt paths already accept both keys during the window (see masterKey.ts).
 */

import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { eq, isNull } from "@bob/db";
import { db } from "@bob/db/client";
import {
  browserCookies as _browserCookies,
  gitProviderConnections,
  sessionSecrets,
} from "@bob/db/schema";

import { auditSecretAccess } from "./secretAccessAudit";
import {
  cookieNeedsReencryption,
  reencryptCookieValue,
} from "./cookieVault";
import { requireEncryptionConfigured } from "./masterKey";
import {
  reencryptSessionSecretValue,
  sessionSecretNeedsReencryption,
} from "./sessionSecretVault";
import { reencryptToken, tokenNeedsReencryption } from "./tokenVault";
import type { EncryptedToken } from "./tokenVault";

// drizzle-orm dual-instance shim: browserCookies is defined in @bob/cookies,
// which resolves a different drizzle-orm peer-hash copy of 0.44.7 than
// @bob/api / @bob/db, so it is nominally incompatible with this package s
// drizzle query builder (see handlers/cookies.ts for the full explanation).
// Table-position uses (.select().from / .update) go through the base PgTable
// type via unknown, column-position uses (eq()) through a small column record,
// and the query result is cast to the real row shape -- all still type-checked,
// no any. sessionSecrets comes from @bob/secrets, which shares @bob/api s
// instance, so it needs no shim. Runtime is unaffected. Root fix is to dedupe
// drizzle-orm in the lockfile (reported, not changed here).
interface BrowserCookiesColumns {
  id: PgColumn;
}
const browserCookies = _browserCookies as unknown as PgTable &
  BrowserCookiesColumns;

interface BrowserCookieRow {
  id: string;
  userId: string;
  domain: string;
  valueCiphertext: string;
  valueIv: string;
  valueTag: string;
}

export interface VaultRotationResult {
  gitTokens: { scanned: number; reencrypted: number; skipped: number; errors: number };
  cookies: { scanned: number; reencrypted: number; skipped: number; errors: number };
  sessionSecrets: {
    scanned: number;
    reencrypted: number;
    skipped: number;
    errors: number;
  };
}

export async function rotateTokenVaultMaterial(): Promise<VaultRotationResult> {
  requireEncryptionConfigured();

  const result: VaultRotationResult = {
    gitTokens: { scanned: 0, reencrypted: 0, skipped: 0, errors: 0 },
    cookies: { scanned: 0, reencrypted: 0, skipped: 0, errors: 0 },
    sessionSecrets: { scanned: 0, reencrypted: 0, skipped: 0, errors: 0 },
  };

  // ── Git provider tokens ──────────────────────────────────────────
  const connections = await db.query.gitProviderConnections.findMany({
    where: isNull(gitProviderConnections.revokedAt),
  });
  result.gitTokens.scanned = connections.length;

  for (const conn of connections) {
    try {
      const accessEnvelope: EncryptedToken = {
        ciphertext: conn.accessTokenCiphertext,
        iv: conn.accessTokenIv,
        tag: conn.accessTokenTag,
      };

      const accessNeeds = tokenNeedsReencryption(accessEnvelope, conn.id);
      let refreshNeeds = false;
      let refreshEnvelope: EncryptedToken | null = null;
      if (
        conn.refreshTokenCiphertext &&
        conn.refreshTokenIv &&
        conn.refreshTokenTag
      ) {
        refreshEnvelope = {
          ciphertext: conn.refreshTokenCiphertext,
          iv: conn.refreshTokenIv,
          tag: conn.refreshTokenTag,
        };
        refreshNeeds = tokenNeedsReencryption(refreshEnvelope, conn.id);
      }

      if (!accessNeeds && !refreshNeeds) {
        result.gitTokens.skipped++;
        continue;
      }

      const newAccess = reencryptToken(accessEnvelope, conn.id);
      const newRefresh = refreshEnvelope
        ? reencryptToken(refreshEnvelope, conn.id)
        : null;

      await db
        .update(gitProviderConnections)
        .set({
          accessTokenCiphertext: newAccess.ciphertext,
          accessTokenIv: newAccess.iv,
          accessTokenTag: newAccess.tag,
          ...(newRefresh
            ? {
                refreshTokenCiphertext: newRefresh.ciphertext,
                refreshTokenIv: newRefresh.iv,
                refreshTokenTag: newRefresh.tag,
              }
            : {}),
        })
        .where(eq(gitProviderConnections.id, conn.id));

      result.gitTokens.reencrypted++;
      auditSecretAccess({
        resource: "git_token",
        action: "rotate",
        userId: conn.userId,
        resourceId: conn.id,
        success: true,
      });
    } catch (err) {
      result.gitTokens.errors++;
      auditSecretAccess({
        resource: "git_token",
        action: "rotate",
        userId: conn.userId,
        resourceId: conn.id,
        success: false,
        detail: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  // ── Browser cookies ──────────────────────────────────────────────
  const cookies = (await db
    .select()
    .from(browserCookies)) as unknown as BrowserCookieRow[];
  result.cookies.scanned = cookies.length;

  for (const cookie of cookies) {
    try {
      const envelope = {
        ciphertext: cookie.valueCiphertext,
        iv: cookie.valueIv,
        tag: cookie.valueTag,
      };
      if (!cookieNeedsReencryption(envelope, cookie.id)) {
        result.cookies.skipped++;
        continue;
      }
      const next = reencryptCookieValue(envelope, cookie.id);
      await db
        .update(browserCookies)
        .set({
          valueCiphertext: next.ciphertext,
          valueIv: next.iv,
          valueTag: next.tag,
        })
        .where(eq(browserCookies.id, cookie.id));
      result.cookies.reencrypted++;
      auditSecretAccess({
        resource: "browser_cookie",
        action: "rotate",
        userId: cookie.userId,
        resourceId: cookie.id,
        domain: cookie.domain,
        success: true,
      });
    } catch (err) {
      result.cookies.errors++;
      auditSecretAccess({
        resource: "browser_cookie",
        action: "rotate",
        userId: cookie.userId,
        resourceId: cookie.id,
        domain: cookie.domain,
        success: false,
        detail: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  // ── Session secrets ──────────────────────────────────────────────
  const secrets = await db.select().from(sessionSecrets);
  result.sessionSecrets.scanned = secrets.length;

  for (const secret of secrets) {
    if (!secret.valueCiphertext || !secret.valueIv || !secret.valueTag) {
      result.sessionSecrets.skipped++;
      continue;
    }
    try {
      const envelope = {
        ciphertext: secret.valueCiphertext,
        iv: secret.valueIv,
        tag: secret.valueTag,
      };
      if (!sessionSecretNeedsReencryption(envelope, secret.id)) {
        result.sessionSecrets.skipped++;
        continue;
      }
      const next = reencryptSessionSecretValue(envelope, secret.id);
      await db
        .update(sessionSecrets)
        .set({
          valueCiphertext: next.ciphertext,
          valueIv: next.iv,
          valueTag: next.tag,
        })
        .where(eq(sessionSecrets.id, secret.id));
      result.sessionSecrets.reencrypted++;
      auditSecretAccess({
        resource: "session_secret",
        action: "rotate",
        userId: secret.userId,
        sessionId: secret.sessionId,
        resourceId: secret.id,
        success: true,
      });
    } catch (err) {
      result.sessionSecrets.errors++;
      auditSecretAccess({
        resource: "session_secret",
        action: "rotate",
        userId: secret.userId,
        sessionId: secret.sessionId,
        resourceId: secret.id,
        success: false,
        detail: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return result;
}
