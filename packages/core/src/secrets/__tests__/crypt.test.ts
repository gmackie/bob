import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptSecretValue,
  encryptSecretValue,
  type EncryptedEnvelope,
} from "../crypt.js";

const GOOD_KEY = "0123456789abcdef0123456789abcdef"; // exactly 32 chars

describe("@gmacko/secrets crypt", () => {
  beforeEach(() => {
    process.env.GMACKO_SECRET_ENCRYPTION_KEY = GOOD_KEY;
  });

  afterEach(() => {
    delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
  });

  it("round-trips plaintext through encrypt + decrypt with the same secretId", () => {
    const secretId = "secret-abc";
    const envelope = encryptSecretValue("hello", secretId);
    expect(envelope.ciphertext).toBeTypeOf("string");
    expect(envelope.iv).toBeTypeOf("string");
    expect(envelope.tag).toBeTypeOf("string");

    const plaintext = decryptSecretValue(envelope, secretId);
    expect(plaintext).toBe("hello");
  });

  it("produces different ciphertexts for the same plaintext under different secretIds", () => {
    const plaintext = "super-secret-token";
    const envelopeA = encryptSecretValue(plaintext, "id-a");
    const envelopeB = encryptSecretValue(plaintext, "id-b");

    // HMAC-derived row keys (and random IVs) should produce distinct ciphertexts.
    expect(envelopeA.ciphertext).not.toBe(envelopeB.ciphertext);

    // Cross-key decryption must not succeed: envelopeA cannot be decrypted with "id-b"'s key.
    expect(() => decryptSecretValue(envelopeA, "id-b")).toThrow();
  });

  it("fails with an auth-tag error when decrypting with the wrong secretId", () => {
    const envelope = encryptSecretValue("payload", "id-a");
    expect(() => decryptSecretValue(envelope, "id-b")).toThrow();
  });

  it("throws when the master key env var is missing", () => {
    delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecretValue("x", "id-a")).toThrow(
      /GMACKO_SECRET_ENCRYPTION_KEY/,
    );
  });

  it("throws when the master key env var is shorter than 32 characters", () => {
    process.env.GMACKO_SECRET_ENCRYPTION_KEY = "tooShort10"; // 10 chars
    expect(() => encryptSecretValue("x", "id-a")).toThrow(/32/);
  });
});

// Type-only assertion — ensures the EncryptedEnvelope export stays structural.
const _envelopeShape: EncryptedEnvelope = {
  ciphertext: "",
  iv: "",
  tag: "",
};
void _envelopeShape;
