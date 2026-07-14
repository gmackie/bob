import { describe, expect, it } from "vitest";

import { getDeviceFlowToken, isApiKey, parseQR } from "./device-auth";

describe("mobile device-auth", () => {
  describe("isApiKey", () => {
    it("accepts bob_ and gmk_ prefixed strings", () => {
      expect(isApiKey("bob_abc123")).toBe(true);
      expect(isApiKey("gmk_abc123")).toBe(true);
    });

    it("rejects non-keys", () => {
      expect(isApiKey("session=xyz")).toBe(false);
      expect(isApiKey("")).toBe(false);
      expect(isApiKey(null)).toBe(false);
      expect(isApiKey(42)).toBe(false);
    });
  });

  describe("parseQR", () => {
    it("parses a valid {url, token} payload", () => {
      const data = JSON.stringify({
        url: "https://bob.blder.bot",
        token: "bob_live_key",
      });
      expect(parseQR(data)).toEqual({
        url: "https://bob.blder.bot",
        token: "bob_live_key",
      });
    });

    it("rejects payloads whose token is not a Bob API key", () => {
      const data = JSON.stringify({
        url: "https://bob.blder.bot",
        token: "not-a-key",
      });
      expect(parseQR(data)).toBeNull();
    });

    it("rejects payloads missing a url", () => {
      expect(parseQR(JSON.stringify({ token: "bob_x" }))).toBeNull();
    });

    it("rejects non-JSON data", () => {
      expect(parseQR("just a string")).toBeNull();
    });
  });

  describe("getDeviceFlowToken", () => {
    it("extracts apiKey from a completed poll response", () => {
      expect(getDeviceFlowToken({ status: "complete", apiKey: "bob_k" })).toBe(
        "bob_k",
      );
    });

    it("tolerates token / access_token aliases", () => {
      expect(getDeviceFlowToken({ token: "gmk_k" })).toBe("gmk_k");
      expect(getDeviceFlowToken({ access_token: "bob_k" })).toBe("bob_k");
    });

    it("returns null while pending or on a non-key value", () => {
      expect(getDeviceFlowToken({ status: "pending" })).toBeNull();
      expect(getDeviceFlowToken({ apiKey: "nope" })).toBeNull();
      expect(getDeviceFlowToken(null)).toBeNull();
    });
  });
});
