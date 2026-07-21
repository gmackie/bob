import { beforeAll, describe, expect, it } from "vitest";

import {
  decryptSessionSecretValue,
  encryptSessionSecretValue,
} from "../sessionSecretVault.js";

const TEST_KEY = "test-session-secret-encryption-key";

beforeAll(() => {
  process.env.GIT_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

describe("sessionSecretVault", () => {
  it("encrypts and decrypts a session secret value", () => {
    const secretId = "session-secret-1";
    const plaintext = "ghp_abc123";

    const encrypted = encryptSessionSecretValue(plaintext, secretId);

    expect(encrypted).toHaveProperty("ciphertext");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("tag");
    expect(encrypted.ciphertext).not.toBe(plaintext);

    const decrypted = decryptSessionSecretValue(encrypted, secretId);
    expect(decrypted).toBe(plaintext);
  });

  it("fails to decrypt with a different secret id", () => {
    const encrypted = encryptSessionSecretValue("super-secret", "secret-A");

    expect(() => decryptSessionSecretValue(encrypted, "secret-B")).toThrow();
  });

  it("detects tampered ciphertext", () => {
    const encrypted = encryptSessionSecretValue("super-secret", "secret-A");
    const buf = Buffer.from(encrypted.ciphertext, "base64");
    buf[0] = ((buf[0] ?? 0) + 1) % 256;
    encrypted.ciphertext = buf.toString("base64");

    expect(() => decryptSessionSecretValue(encrypted, "secret-A")).toThrow();
  });
});
