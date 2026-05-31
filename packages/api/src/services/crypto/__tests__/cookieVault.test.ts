import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { decryptCookieValue, encryptCookieValue } from "../cookieVault.js";

const TEST_KEY = "test-cookie-encryption-key-32chs";

beforeAll(() => {
  process.env.GIT_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

describe("cookieVault", () => {
  afterEach(() => {
    delete process.env.GIT_TOKEN_ENCRYPTION_KEYS;
    process.env.GIT_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  describe("encrypt / decrypt round-trip", () => {
    it("should encrypt and decrypt a cookie value", () => {
      const cookieId = "cookie-uuid-1";
      const plaintext = "session_abc123";

      const encrypted = encryptCookieValue(plaintext, cookieId);

      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = decryptCookieValue(encrypted, cookieId);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for same value (random IV)", () => {
      const cookieId = "cookie-1";
      const plaintext = "same-value";

      const a = encryptCookieValue(plaintext, cookieId);
      const b = encryptCookieValue(plaintext, cookieId);

      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it("should handle empty string value", () => {
      const cookieId = "cookie-empty";
      const encrypted = encryptCookieValue("", cookieId);
      expect(decryptCookieValue(encrypted, cookieId)).toBe("");
    });

    it("should handle long cookie values", () => {
      const cookieId = "cookie-long";
      const plaintext = "x".repeat(8000);
      const encrypted = encryptCookieValue(plaintext, cookieId);
      expect(decryptCookieValue(encrypted, cookieId)).toBe(plaintext);
    });

    it("should handle special characters and unicode", () => {
      const cookieId = "cookie-special";
      const plaintext = "val=abc; path=/; domain=.example.com; 🍪";
      const encrypted = encryptCookieValue(plaintext, cookieId);
      expect(decryptCookieValue(encrypted, cookieId)).toBe(plaintext);
    });
  });

  describe("key isolation per cookie ID", () => {
    it("should fail to decrypt with a different cookie ID", () => {
      const plaintext = "secret-session-value";
      const encrypted = encryptCookieValue(plaintext, "cookie-A");

      expect(() => decryptCookieValue(encrypted, "cookie-B")).toThrow();
    });
  });

  describe("key rotation", () => {
    it("decrypts with retired keys during rotation", () => {
      const oldKey = "old-cookie-vault-key-material-32";
      const newKey = "new-cookie-vault-key-material-32";

      process.env.GIT_TOKEN_ENCRYPTION_KEY = oldKey;
      const encrypted = encryptCookieValue("session-value", "cookie-A");

      process.env.GIT_TOKEN_ENCRYPTION_KEYS = `${newKey},${oldKey}`;

      expect(decryptCookieValue(encrypted, "cookie-A")).toBe("session-value");
    });
  });

  describe("tamper detection", () => {
    it("should detect tampered ciphertext", () => {
      const encrypted = encryptCookieValue("val", "cookie-1");
      const buf = Buffer.from(encrypted.ciphertext, "base64");
      buf[0] = (buf[0]! + 1) % 256;
      encrypted.ciphertext = buf.toString("base64");

      expect(() => decryptCookieValue(encrypted, "cookie-1")).toThrow();
    });

    it("should detect tampered IV", () => {
      const encrypted = encryptCookieValue("val", "cookie-1");
      const buf = Buffer.from(encrypted.iv, "base64");
      buf[0] = (buf[0]! + 1) % 256;
      encrypted.iv = buf.toString("base64");

      expect(() => decryptCookieValue(encrypted, "cookie-1")).toThrow();
    });

    it("should detect tampered auth tag", () => {
      const encrypted = encryptCookieValue("val", "cookie-1");
      const buf = Buffer.from(encrypted.tag, "base64");
      buf[0] = (buf[0]! + 1) % 256;
      encrypted.tag = buf.toString("base64");

      expect(() => decryptCookieValue(encrypted, "cookie-1")).toThrow();
    });
  });

  describe("missing encryption key", () => {
    it("should throw when GIT_TOKEN_ENCRYPTION_KEY is not set", () => {
      const saved = process.env.GIT_TOKEN_ENCRYPTION_KEY;
      delete process.env.GIT_TOKEN_ENCRYPTION_KEY;

      try {
        expect(() => encryptCookieValue("val", "id")).toThrow(
          "GIT_TOKEN_ENCRYPTION_KEY",
        );
      } finally {
        process.env.GIT_TOKEN_ENCRYPTION_KEY = saved;
      }
    });

    it("should throw when key is too short", () => {
      const saved = process.env.GIT_TOKEN_ENCRYPTION_KEY;
      process.env.GIT_TOKEN_ENCRYPTION_KEY = "short";

      try {
        expect(() => encryptCookieValue("val", "id")).toThrow("at least");
      } finally {
        process.env.GIT_TOKEN_ENCRYPTION_KEY = saved;
      }
    });
  });
});
