import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CURRENT_KEY_ENV,
  getCurrentMasterKey,
  getDecryptMasterKeys,
  getPreviousMasterKey,
  isEncryptionConfigured,
  KEY_LENGTH,
  PREVIOUS_KEY_ENV,
  requireEncryptionConfigured,
} from "../masterKey.js";

const GOOD = "0123456789abcdef0123456789abcdef";
const PREV = "fedcba9876543210fedcba9876543210";

describe("masterKey", () => {
  const savedCurrent = process.env[CURRENT_KEY_ENV];
  const savedPrevious = process.env[PREVIOUS_KEY_ENV];

  beforeEach(() => {
    process.env[CURRENT_KEY_ENV] = GOOD;
    delete process.env[PREVIOUS_KEY_ENV];
  });

  afterEach(() => {
    if (savedCurrent === undefined) delete process.env[CURRENT_KEY_ENV];
    else process.env[CURRENT_KEY_ENV] = savedCurrent;
    if (savedPrevious === undefined) delete process.env[PREVIOUS_KEY_ENV];
    else process.env[PREVIOUS_KEY_ENV] = savedPrevious;
  });

  it("isEncryptionConfigured is true when current key is long enough", () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it("isEncryptionConfigured is false when current key is missing", () => {
    delete process.env[CURRENT_KEY_ENV];
    expect(isEncryptionConfigured()).toBe(false);
  });

  it("isEncryptionConfigured is false when current key is short", () => {
    process.env[CURRENT_KEY_ENV] = "short";
    expect(isEncryptionConfigured()).toBe(false);
  });

  it("requireEncryptionConfigured throws when missing", () => {
    delete process.env[CURRENT_KEY_ENV];
    expect(() => requireEncryptionConfigured()).toThrow(CURRENT_KEY_ENV);
  });

  it("getCurrentMasterKey returns a 32-byte buffer", () => {
    const key = getCurrentMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(KEY_LENGTH);
  });

  it("getPreviousMasterKey returns null when unset", () => {
    expect(getPreviousMasterKey()).toBeNull();
  });

  it("getPreviousMasterKey returns the previous key when set", () => {
    process.env[PREVIOUS_KEY_ENV] = PREV;
    const key = getPreviousMasterKey();
    expect(key).not.toBeNull();
    if (key === null) throw new Error("expected a previous key");
    expect(key.length).toBe(KEY_LENGTH);
  });

  it("getPreviousMasterKey throws when previous is set but short", () => {
    process.env[PREVIOUS_KEY_ENV] = "too-short";
    expect(() => getPreviousMasterKey()).toThrow(PREVIOUS_KEY_ENV);
  });

  it("getDecryptMasterKeys returns current only when no previous", () => {
    const keys = getDecryptMasterKeys();
    expect(keys).toHaveLength(1);
  });

  it("getDecryptMasterKeys returns current then previous during rotation", () => {
    process.env[PREVIOUS_KEY_ENV] = PREV;
    const keys = getDecryptMasterKeys();
    expect(keys).toHaveLength(2);
    const [first, second] = keys;
    if (!first || !second) throw new Error("expected two keys");
    expect(first.equals(getCurrentMasterKey())).toBe(true);
    const previous = getPreviousMasterKey();
    if (previous === null) throw new Error("expected a previous key");
    expect(second.equals(previous)).toBe(true);
  });
});
