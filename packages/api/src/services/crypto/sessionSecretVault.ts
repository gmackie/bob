import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { getEncryptionKeys, getPrimaryEncryptionKey } from "./keyring";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

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
  const masterKey = getPrimaryEncryptionKey();
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

export function decryptSessionSecretValue(
  encrypted: EncryptedSessionSecretValue,
  secretId: string,
): string {
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  for (const masterKey of getEncryptionKeys()) {
    try {
      const rowKey = deriveSessionSecretKey(masterKey, secretId);
      const decipher = createDecipheriv(ALGORITHM, rowKey, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch {
      // Try retired keys configured after the primary key.
    }
  }

  throw new Error("Unable to decrypt session secret with configured keyring");
}
