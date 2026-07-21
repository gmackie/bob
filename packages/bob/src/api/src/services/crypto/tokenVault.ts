import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  getCurrentMasterKey,
  getDecryptMasterKeys,
  isEncryptionConfigured as isMasterKeyConfigured,
  KEY_LENGTH,
  requireEncryptionConfigured,
} from "./masterKey";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveRowKey(masterKey: Buffer, connectionId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(connectionId)
    .digest()
    .subarray(0, KEY_LENGTH);
}

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptToken(
  plaintext: string,
  connectionId: string,
): EncryptedToken {
  const masterKey = getCurrentMasterKey();
  const rowKey = deriveRowKey(masterKey, connectionId);
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

function tryDecryptWithKey(
  encrypted: EncryptedToken,
  connectionId: string,
  masterKey: Buffer,
): string {
  const rowKey = deriveRowKey(masterKey, connectionId);

  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, rowKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Decrypt a token. Tries the current master key first, then the previous
 * key (rotation window). Throws if none succeed.
 */
export function decryptToken(
  encrypted: EncryptedToken,
  connectionId: string,
): string {
  const keys = getDecryptMasterKeys();
  let lastError: unknown;
  for (const key of keys) {
    try {
      return tryDecryptWithKey(encrypted, connectionId, key);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to decrypt token with available master keys");
}

/**
 * True when the envelope decrypts with the previous key but not the current
 * one — i.e. the row still needs re-encryption after a key rotation.
 */
export function tokenNeedsReencryption(
  encrypted: EncryptedToken,
  connectionId: string,
): boolean {
  const keys = getDecryptMasterKeys();
  const [firstKey, secondKey] = keys;
  if (!firstKey || !secondKey) return false;

  try {
    tryDecryptWithKey(encrypted, connectionId, firstKey);
    return false;
  } catch {
    // fall through
  }

  try {
    tryDecryptWithKey(encrypted, connectionId, secondKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decrypt with any available key and re-encrypt under the current master key.
 * Idempotent when already on the current key.
 */
export function reencryptToken(
  encrypted: EncryptedToken,
  connectionId: string,
): EncryptedToken {
  const plaintext = decryptToken(encrypted, connectionId);
  return encryptToken(plaintext, connectionId);
}

export function isEncryptionConfigured(): boolean {
  return isMasterKeyConfigured();
}

export { requireEncryptionConfigured };
