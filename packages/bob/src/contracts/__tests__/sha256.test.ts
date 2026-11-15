import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../sha256.js";

const node = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("sha256Hex", () => {
  it("matches the NIST vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node:crypto across block boundaries and non-ASCII text", () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const text = "a".repeat(length);
      expect(sha256Hex(text)).toBe(node(text));
    }
    const unicode = JSON.stringify(["v1", "café", "owner:é", "🚀"]);
    expect(sha256Hex(unicode)).toBe(node(unicode));
  });
});
