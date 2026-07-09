import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cookieNeedsReencryption,
  decryptCookieValue,
  encryptCookieValue,
  reencryptCookieValue,
} from "../cookieVault.js";
import {
  decryptSessionSecretValue,
  encryptSessionSecretValue,
  reencryptSessionSecretValue,
  sessionSecretNeedsReencryption,
} from "../sessionSecretVault.js";
import {
  decryptToken,
  encryptToken,
  reencryptToken,
  tokenNeedsReencryption,
} from "../tokenVault.js";
import {
  CURRENT_KEY_ENV,
  PREVIOUS_KEY_ENV,
} from "../masterKey.js";

const OLD_KEY = "old-master-key-32-chars-long!!!!!";
const NEW_KEY = "new-master-key-32-chars-long!!!!!";

describe("vault key rotation (unit)", () => {
  const savedCurrent = process.env[CURRENT_KEY_ENV];
  const savedPrevious = process.env[PREVIOUS_KEY_ENV];

  afterEach(() => {
    if (savedCurrent === undefined) delete process.env[CURRENT_KEY_ENV];
    else process.env[CURRENT_KEY_ENV] = savedCurrent;
    if (savedPrevious === undefined) delete process.env[PREVIOUS_KEY_ENV];
    else process.env[PREVIOUS_KEY_ENV] = savedPrevious;
  });

  describe("token vault", () => {
    it("decrypts material encrypted under the previous key after rotation", () => {
      process.env[CURRENT_KEY_ENV] = OLD_KEY;
      delete process.env[PREVIOUS_KEY_ENV];

      const connectionId = "conn-rotate-1";
      const encrypted = encryptToken("ghp_token_abc", connectionId);

      process.env[CURRENT_KEY_ENV] = NEW_KEY;
      process.env[PREVIOUS_KEY_ENV] = OLD_KEY;

      expect(decryptToken(encrypted, connectionId)).toBe("ghp_token_abc");
      expect(tokenNeedsReencryption(encrypted, connectionId)).toBe(true);

      const rotated = reencryptToken(encrypted, connectionId);
      expect(decryptToken(rotated, connectionId)).toBe("ghp_token_abc");
      expect(tokenNeedsReencryption(rotated, connectionId)).toBe(false);

      // After dropping the previous key, still readable under current.
      delete process.env[PREVIOUS_KEY_ENV];
      expect(decryptToken(rotated, connectionId)).toBe("ghp_token_abc");
    });

    it("fails decrypt when neither current nor previous can open the envelope", () => {
      process.env[CURRENT_KEY_ENV] = OLD_KEY;
      const encrypted = encryptToken("x", "conn-1");
      process.env[CURRENT_KEY_ENV] = NEW_KEY;
      process.env[PREVIOUS_KEY_ENV] = "totally-different-key-32chars!!";
      expect(() => decryptToken(encrypted, "conn-1")).toThrow();
    });
  });

  describe("cookie vault", () => {
    it("supports previous-key decrypt and reencrypt", () => {
      process.env[CURRENT_KEY_ENV] = OLD_KEY;
      delete process.env[PREVIOUS_KEY_ENV];

      const cookieId = "cookie-1";
      const encrypted = encryptCookieValue("session=abc", cookieId);

      process.env[CURRENT_KEY_ENV] = NEW_KEY;
      process.env[PREVIOUS_KEY_ENV] = OLD_KEY;

      expect(decryptCookieValue(encrypted, cookieId)).toBe("session=abc");
      expect(cookieNeedsReencryption(encrypted, cookieId)).toBe(true);

      const rotated = reencryptCookieValue(encrypted, cookieId);
      expect(cookieNeedsReencryption(rotated, cookieId)).toBe(false);
      delete process.env[PREVIOUS_KEY_ENV];
      expect(decryptCookieValue(rotated, cookieId)).toBe("session=abc");
    });
  });

  describe("session secret vault", () => {
    it("supports previous-key decrypt and reencrypt", () => {
      process.env[CURRENT_KEY_ENV] = OLD_KEY;
      delete process.env[PREVIOUS_KEY_ENV];

      const secretId = "secret-1";
      const encrypted = encryptSessionSecretValue("super-secret", secretId);

      process.env[CURRENT_KEY_ENV] = NEW_KEY;
      process.env[PREVIOUS_KEY_ENV] = OLD_KEY;

      expect(decryptSessionSecretValue(encrypted, secretId)).toBe(
        "super-secret",
      );
      expect(sessionSecretNeedsReencryption(encrypted, secretId)).toBe(true);

      const rotated = reencryptSessionSecretValue(encrypted, secretId);
      expect(sessionSecretNeedsReencryption(rotated, secretId)).toBe(false);
      delete process.env[PREVIOUS_KEY_ENV];
      expect(decryptSessionSecretValue(rotated, secretId)).toBe("super-secret");
    });
  });
});
