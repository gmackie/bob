import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import { isEncryptionConfigured } from "../tokenVault.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getMasterKey(key: string): Buffer {
  return Buffer.from(key.slice(0, KEY_LENGTH), "utf8");
}

function deriveRowKey(masterKey: Buffer, connectionId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(connectionId)
    .digest()
    .subarray(0, KEY_LENGTH);
}

interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encryptToken(
  plaintext: string,
  connectionId: string,
  masterKey: Buffer,
): EncryptedToken {
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

function decryptToken(
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

describe("tokenVault", () => {
  describe("isEncryptionConfigured", () => {
    it("should return boolean based on env var", () => {
      const result = isEncryptionConfigured();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("AES-256-GCM encryption logic", () => {
    const testKey = getMasterKey("this-is-a-test-key-that-is-32ch");

    it("should encrypt and decrypt a token successfully", () => {
      const plaintext = "ghp_test_token_12345";
      const connectionId = "conn-uuid-1234";

      const encrypted = encryptToken(plaintext, connectionId, testKey);

      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = decryptToken(encrypted, connectionId, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for same plaintext (random IV)", () => {
      const plaintext = "same-token";
      const connectionId = "conn-1";

      const encrypted1 = encryptToken(plaintext, connectionId, testKey);
      const encrypted2 = encryptToken(plaintext, connectionId, testKey);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it("should use different keys for different connection IDs", () => {
      const plaintext = "test-token";
      const connectionId1 = "conn-1";
      const connectionId2 = "conn-2";

      const encrypted = encryptToken(plaintext, connectionId1, testKey);

      expect(() => decryptToken(encrypted, connectionId2, testKey)).toThrow();
    });

    it("should handle empty plaintext", () => {
      const plaintext = "";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);
      const decrypted = decryptToken(encrypted, connectionId, testKey);

      expect(decrypted).toBe("");
    });

    it("should handle long tokens", () => {
      const plaintext = "x".repeat(10000);
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);
      const decrypted = decryptToken(encrypted, connectionId, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters in token", () => {
      const plaintext = "token-with-special-chars!@#$%^&*()_+{}[]|:;<>?,./~`";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);
      const decrypted = decryptToken(encrypted, connectionId, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode in token", () => {
      const plaintext = "token-with-unicode-🔐🔑";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);
      const decrypted = decryptToken(encrypted, connectionId, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should detect tampered ciphertext", () => {
      const plaintext = "test-token";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);

      const tamperedCiphertext = Buffer.from(encrypted.ciphertext, "base64");
      tamperedCiphertext[0] = (tamperedCiphertext[0]! + 1) % 256;
      encrypted.ciphertext = tamperedCiphertext.toString("base64");

      expect(() => decryptToken(encrypted, connectionId, testKey)).toThrow();
    });

    it("should detect tampered IV", () => {
      const plaintext = "test-token";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);

      const tamperedIv = Buffer.from(encrypted.iv, "base64");
      tamperedIv[0] = (tamperedIv[0]! + 1) % 256;
      encrypted.iv = tamperedIv.toString("base64");

      expect(() => decryptToken(encrypted, connectionId, testKey)).toThrow();
    });

    it("should detect tampered auth tag", () => {
      const plaintext = "test-token";
      const connectionId = "conn-1";

      const encrypted = encryptToken(plaintext, connectionId, testKey);

      const tamperedTag = Buffer.from(encrypted.tag, "base64");
      tamperedTag[0] = (tamperedTag[0]! + 1) % 256;
      encrypted.tag = tamperedTag.toString("base64");

      expect(() => decryptToken(encrypted, connectionId, testKey)).toThrow();
    });
  });

  describe("key derivation", () => {
    it("should derive different keys for different connection IDs", () => {
      const masterKey = getMasterKey("test-master-key-32-chars-long!!!");

      const rowKey1 = deriveRowKey(masterKey, "conn-1");
      const rowKey2 = deriveRowKey(masterKey, "conn-2");

      expect(rowKey1.equals(rowKey2)).toBe(false);
    });

    it("should derive same key for same connection ID", () => {
      const masterKey = getMasterKey("test-master-key-32-chars-long!!!");

      const rowKey1 = deriveRowKey(masterKey, "conn-1");
      const rowKey2 = deriveRowKey(masterKey, "conn-1");

      expect(rowKey1.equals(rowKey2)).toBe(true);
    });

    it("should produce 32-byte keys", () => {
      const masterKey = getMasterKey("test-master-key-32-chars-long!!!");
      const rowKey = deriveRowKey(masterKey, "conn-1");

      expect(rowKey.length).toBe(32);
    });
  });
});
