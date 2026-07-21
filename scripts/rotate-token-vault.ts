#!/usr/bin/env npx tsx
/**
 * Re-encrypt git tokens, browser cookies, and session secrets under the
 * current GIT_TOKEN_ENCRYPTION_KEY.
 *
 * Prerequisites:
 *   - GIT_TOKEN_ENCRYPTION_KEY = new key
 *   - GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS = old key (required for rows still on old key)
 *   - DATABASE_URL points at the target Bob database
 *
 * See docs/security/secrets-token-storage.md for the full runbook.
 */
import { rotateTokenVaultMaterial } from "../packages/bob/src/api/src/services/crypto/vaultRotation.ts";

async function main() {
  console.log("[rotate-token-vault] starting re-encryption…");
  const result = await rotateTokenVaultMaterial();
  console.log(JSON.stringify(result, null, 2));

  const errors =
    result.gitTokens.errors +
    result.cookies.errors +
    result.sessionSecrets.errors;
  if (errors > 0) {
    console.error(`[rotate-token-vault] completed with ${errors} error(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("[rotate-token-vault] done — safe to drop GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS after verification");
}

main().catch((err) => {
  console.error("[rotate-token-vault] fatal:", err);
  process.exitCode = 1;
});
