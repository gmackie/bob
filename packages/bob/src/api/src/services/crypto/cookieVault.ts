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

function deriveCookieKey(masterKey: Buffer, cookieId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`cookie:${cookieId}`)
    .digest()
    .subarray(0, KEY_LENGTH);
}

export interface EncryptedCookieValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptCookieValue(
  plaintext: string,
  cookieId: string,
): EncryptedCookieValue {
  const masterKey = getCurrentMasterKey();
  const rowKey = deriveCookieKey(masterKey, cookieId);
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
  encrypted: EncryptedCookieValue,
  cookieId: string,
  masterKey: Buffer,
): string {
  const rowKey = deriveCookieKey(masterKey, cookieId);

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
 * Decrypt a cookie value. Tries current master key, then previous (rotation).
 */
export function decryptCookieValue(
  encrypted: EncryptedCookieValue,
  cookieId: string,
): string {
  const keys = getDecryptMasterKeys();
  let lastError: unknown;
  for (const key of keys) {
    try {
      return tryDecryptWithKey(encrypted, cookieId, key);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to decrypt cookie with available master keys");
}

export function cookieNeedsReencryption(
  encrypted: EncryptedCookieValue,
  cookieId: string,
): boolean {
  const keys = getDecryptMasterKeys();
  if (keys.length < 2) return false;

  try {
    tryDecryptWithKey(encrypted, cookieId, keys[0]!);
    return false;
  } catch {
    // fall through
  }

  try {
    tryDecryptWithKey(encrypted, cookieId, keys[1]!);
    return true;
  } catch {
    return false;
  }
}

export function reencryptCookieValue(
  encrypted: EncryptedCookieValue,
  cookieId: string,
): EncryptedCookieValue {
  const plaintext = decryptCookieValue(encrypted, cookieId);
  return encryptCookieValue(plaintext, cookieId);
}
