/**
 * Session-secret vault crypto (ported from Bob's `sessionSecretVault.ts`).
 *
 * Envelope pattern:
 *   - Each stored secret row is encrypted with its own row key derived as
 *     `HMAC-SHA256(master, "session-secret:" + secretId).subarray(0, 32)`.
 *   - Encryption uses AES-256-GCM with a fresh 96-bit IV per call.
 *   - The stored envelope is `{ ciphertext, iv, tag }` — all base64 strings.
 *
 * Why per-secret row keys?
 *   Deriving a distinct key per `secretId` limits the blast radius of a single
 *   row leak: leaking the envelope for one secret does not reveal the key for
 *   any other secret, even under the same master key. The master key only
 *   lives in-process and is never written to disk by this module.
 *
 * Master key requirements:
 *   - Read from `process.env.GMACKO_SECRET_ENCRYPTION_KEY`.
 *   - Must be **≥ 32 characters** (we take the first 32 UTF-8 bytes as the
 *     HMAC key). Short keys throw a clear error at call time.
 *
 * Scope note:
 *   Phase 6D deliberately does NOT integrate with a KMS. Master-key rotation
 *   and multi-key envelope versioning are future concerns — the shape of
 *   `EncryptedEnvelope` leaves room to add a `keyVersion` field later without
 *   breaking callers that already read `ciphertext`/`iv`/`tag`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const ENV_VAR_NAME = "GMACKO_SECRET_ENCRYPTION_KEY" as const;

function getMasterKey(): Buffer {
  const key = process.env[ENV_VAR_NAME];
  if (!key) {
    throw new Error(
      `${ENV_VAR_NAME} environment variable is required for session secret encryption`,
    );
  }
  if (key.length < KEY_LENGTH) {
    throw new Error(
      `${ENV_VAR_NAME} must be at least ${KEY_LENGTH} characters`,
    );
  }
  return Buffer.from(key.slice(0, KEY_LENGTH), "utf8");
}

function deriveRowKey(masterKey: Buffer, secretId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`session-secret:${secretId}`)
    .digest()
    .subarray(0, KEY_LENGTH);
}

export interface EncryptedEnvelope {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly tag: string; // base64
}

export function encryptSecretValue(
  plaintext: string,
  secretId: string,
): EncryptedEnvelope {
  const masterKey = getMasterKey();
  const rowKey = deriveRowKey(masterKey, secretId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, rowKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecretValue(
  envelope: EncryptedEnvelope,
  secretId: string,
): string {
  const masterKey = getMasterKey();
  const rowKey = deriveRowKey(masterKey, secretId);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, rowKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
