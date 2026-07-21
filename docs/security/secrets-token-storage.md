# Secrets & token storage

Hardening reference for Bob vault material (git provider tokens, browser
cookies, session secrets). Source: BizPulse startup audit task
`2da24303-41a0-4013-afd5-35a8e9b98452` (2026-05-30).

## Encryption keys (required)

| Variable | Required | Role |
|---|---|---|
| `GIT_TOKEN_ENCRYPTION_KEY` | **Yes in production** (≥ 32 chars) | Current master key for AES-256-GCM vaults |
| `GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS` | Optional (≥ 32 chars) | Prior master key during rotation window |

- Production `@bob/auth` env validation **fails closed** if the current key is
  missing or shorter than 32 characters.
- Vault encrypt paths always use the current key; decrypt tries current, then
  previous.
- Shared helpers live in
  [`packages/bob/src/api/src/services/crypto/masterKey.ts`](../../packages/bob/src/api/src/services/crypto/masterKey.ts).
- `requireEncryptionConfigured()` throws when the current key is absent.
  OAuth → git-provider bootstrap soft-skips only outside production.

Gmacko core secrets use a parallel env var `GMACKO_SECRET_ENCRYPTION_KEY`
(see `@gmacko/core` secrets package). Same ≥32-char rule.

## Envelope design

All three Bob vaults share the same pattern:

1. Master key from env (UTF-8, first 32 bytes).
2. Per-row key = `HMAC-SHA256(master, domain-specific-info).subarray(0, 32)`.
3. AES-256-GCM, 96-bit random IV, base64 `{ ciphertext, iv, tag }`.

| Vault | Row-key info | Module |
|---|---|---|
| Git tokens | `connectionId` | `tokenVault.ts` |
| Browser cookies | `"cookie:" + cookieId` | `cookieVault.ts` |
| Session secrets | `"session-secret:" + secretId` | `sessionSecretVault.ts` |

## Rotating token vault material

Dual-key window — no downtime:

1. Generate a new ≥32-char master key (high entropy; e.g. `openssl rand -base64 48`).
2. Set `GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS` to the **old** value.
3. Set `GIT_TOKEN_ENCRYPTION_KEY` to the **new** value.
4. Restart API / worker / gateway processes so they load both keys.
5. Re-encrypt all stored envelopes under the new key:

   ```ts
   import { rotateTokenVaultMaterial } from "@bob/api/…/vaultRotation";
   // or call the exported helper from an ops script
   const result = await rotateTokenVaultMaterial();
   console.log(result);
   ```

   Implementation:
   [`vaultRotation.ts`](../../packages/bob/src/api/src/services/crypto/vaultRotation.ts).
   It re-encrypts non-revoked git provider connections, all browser cookies,
   and all session secrets that still open only under the previous key.

6. Verify: `errors === 0` and reencrypted counts match expectations; spot-check
   decrypts with previous key **unset**.
7. Unset `GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS` and restart again.

Do **not** drop the previous key until every consumer has finished re-encryption.

## Access audit

Plaintext is never written to logs.

| Resource | On decrypt | Durable trail |
|---|---|---|
| Session secrets | Structured `[secret-access-audit]` event + `session_secret_usages` row (`executor: api-decrypt`) + `lastUsedAt` | Yes (DB) |
| Browser cookies | Structured event with `userId`, `sessionId`, `domain`, `count` | Log pipeline |
| Git tokens | Structured event with `userId`, `connectionId`, provider detail | Log pipeline |

Shared emitter:
[`secretAccessAudit.ts`](../../packages/bob/src/api/src/services/crypto/secretAccessAudit.ts)
— ring buffer (500 events) for tests / local diagnostics; stdout JSON for SIEM.

Failed decrypts and unauthorized lookups are also audited (`success: false`).

## Retention

| Data class | Default retention | Purge / lifecycle |
|---|---|---|
| Git provider tokens (encrypted envelopes) | Until user revokes connection or account delete | Soft-revoke sets `revokedAt`; cascade delete with user |
| Browser cookies (encrypted) | Until user removes domain, cookie `expires`, or account delete | `cookies.remove`; expired filtered at read |
| Session secrets (encrypted) | Session lifetime; cascade delete with chat session | Also status `promoted` after ForgeGraph push |
| `session_secret_usages` audit rows | **90 days** operational default | Cascade with secret/session; schedule ops purge older than 90d |
| Structured `[secret-access-audit]` log lines | **90 days** in log store | Configure log shipper retention; no plaintext to retain |
| Master keys | Current key indefinite; previous key only for rotation window (target **≤ 7 days**) | After re-encrypt + verification, delete previous from secret store |

Notes:

- Encryption does not replace retention: envelopes are still personal data /
  credential material. Prefer shortest practical lifetime.
- When a user deletes their account, encrypted vault rows cascade via FKs —
  no separate crypto wipe is required, but rotation after a key compromise
  remains mandatory.
- Ops: purge `session_secret_usages` older than 90 days with a scheduled job
  (or `DELETE … WHERE created_at < now() - interval '90 days'`). Prefer
  keeping at least 30 days for incident response.

## Operator checklist

- [ ] Production secrets store has `GIT_TOKEN_ENCRYPTION_KEY` (≥ 32 chars)
- [ ] Key is unique per environment (dev ≠ staging ≠ prod)
- [ ] Rotation runbook rehearsed (dual-key + `rotateTokenVaultMaterial`)
- [ ] Log pipeline indexes `[secret-access-audit]`
- [ ] 90-day purge for usage audit rows scheduled
- [ ] After any key compromise: rotate master key, re-encrypt, revoke external
      OAuth tokens that may have been exposed in memory dumps
