import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  getCurrentMasterKey,
  getDecryptMasterKeys,
  KEY_LENGTH,
} from "./masterKey";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveSessionSecretKey(masterKey: Buffer, secretId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`session-secret:${secretId}`)
    .digest()
    .subarray(0, KEY_LENGTH);
}

export interface EncryptedSessionSecretValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSessionSecretValue(
  plaintext: string,
  secretId: string,
): EncryptedSessionSecretValue {
  const masterKey = getCurrentMasterKey();
  const rowKey = deriveSessionSecretKey(masterKey, secretId);
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
  encrypted: EncryptedSessionSecretValue,
  secretId: string,
  masterKey: Buffer,
): string {
  const rowKey = deriveSessionSecretKey(masterKey, secretId);

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
 * Decrypt a session secret. Tries current master key, then previous (rotation).
 */
export function decryptSessionSecretValue(
  encrypted: EncryptedSessionSecretValue,
  secretId: string,
): string {
  const keys = getDecryptMasterKeys();
  let lastError: unknown;
  for (const key of keys) {
    try {
      return tryDecryptWithKey(encrypted, secretId, key);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to decrypt session secret with available master keys");
}

export function sessionSecretNeedsReencryption(
  encrypted: EncryptedSessionSecretValue,
  secretId: string,
): boolean {
  const keys = getDecryptMasterKeys();
  if (keys.length < 2) return false;

  try {
    tryDecryptWithKey(encrypted, secretId, keys[0]!);
    return false;
  } catch {
    // fall through
  }

  try {
    tryDecryptWithKey(encrypted, secretId, keys[1]!);
    return true;
  } catch {
    return false;
  }
}

export function reencryptSessionSecretValue(
  encrypted: EncryptedSessionSecretValue,
  secretId: string,
): EncryptedSessionSecretValue {
  const plaintext = decryptSessionSecretValue(encrypted, secretId);
  return encryptSessionSecretValue(plaintext, secretId);
}
