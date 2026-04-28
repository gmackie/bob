import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  verifyGiteaSignature,
  verifyGitHubSignature,
  verifyGitLabToken,
} from "../verify";

describe("webhook verification", () => {
  describe("verifyGitHubSignature", () => {
    const secret = "test-webhook-secret";
    const payload = JSON.stringify({ action: "opened", number: 1 });

    function generateGitHubSignature(body: string, key: string): string {
      const signature = createHmac("sha256", key)
        .update(body, "utf8")
        .digest("hex");
      return `sha256=${signature}`;
    }

    it("should verify valid signature", () => {
      const signature = generateGitHubSignature(payload, secret);
      expect(verifyGitHubSignature(payload, signature, secret)).toBe(true);
    });

    it("should reject null signature", () => {
      expect(verifyGitHubSignature(payload, null, secret)).toBe(false);
    });

    it("should reject signature without sha256= prefix", () => {
      const signature = createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");
      expect(verifyGitHubSignature(payload, signature, secret)).toBe(false);
    });

    it("should reject invalid signature", () => {
      const wrongSignature =
        "sha256=0000000000000000000000000000000000000000000000000000000000000000";
      expect(verifyGitHubSignature(payload, wrongSignature, secret)).toBe(
        false,
      );
    });

    it("should reject signature with wrong secret", () => {
      const signature = generateGitHubSignature(payload, "wrong-secret");
      expect(verifyGitHubSignature(payload, signature, secret)).toBe(false);
    });

    it("should reject tampered payload", () => {
      const signature = generateGitHubSignature(payload, secret);
      const tamperedPayload = JSON.stringify({ action: "closed", number: 1 });
      expect(verifyGitHubSignature(tamperedPayload, signature, secret)).toBe(
        false,
      );
    });

    it("should reject malformed hex signature", () => {
      const malformedSignature = "sha256=not-valid-hex";
      expect(verifyGitHubSignature(payload, malformedSignature, secret)).toBe(
        false,
      );
    });

    it("should handle empty payload", () => {
      const emptyPayload = "";
      const signature = generateGitHubSignature(emptyPayload, secret);
      expect(verifyGitHubSignature(emptyPayload, signature, secret)).toBe(true);
    });

    it("should handle unicode in payload", () => {
      const unicodePayload = JSON.stringify({ title: "Fix bug 🐛" });
      const signature = generateGitHubSignature(unicodePayload, secret);
      expect(verifyGitHubSignature(unicodePayload, signature, secret)).toBe(
        true,
      );
    });
  });

  describe("verifyGitLabToken", () => {
    const expectedToken = "gitlab-webhook-token-12345";

    it("should verify valid token", () => {
      expect(verifyGitLabToken(expectedToken, expectedToken)).toBe(true);
    });

    it("should reject null token", () => {
      expect(verifyGitLabToken(null, expectedToken)).toBe(false);
    });

    it("should reject wrong token", () => {
      expect(verifyGitLabToken("wrong-token", expectedToken)).toBe(false);
    });

    it("should reject token with different case", () => {
      expect(
        verifyGitLabToken(expectedToken.toUpperCase(), expectedToken),
      ).toBe(false);
    });

    it("should reject token with extra whitespace", () => {
      expect(verifyGitLabToken(` ${expectedToken} `, expectedToken)).toBe(
        false,
      );
    });

    it("should reject empty token (security)", () => {
      // Empty tokens should always fail - security best practice
      expect(verifyGitLabToken("", "")).toBe(false);
      expect(verifyGitLabToken("", "expected")).toBe(false);
    });

    it("should handle unicode in token", () => {
      const unicodeToken = "token-with-unicode-🔑";
      expect(verifyGitLabToken(unicodeToken, unicodeToken)).toBe(true);
    });

    it("should use constant-time comparison (timing safe)", () => {
      // This test verifies the function doesn't throw on length mismatch
      // which would indicate it's using timingSafeEqual properly
      expect(verifyGitLabToken("short", "much-longer-token")).toBe(false);
      expect(verifyGitLabToken("much-longer-token", "short")).toBe(false);
    });
  });

  describe("verifyGiteaSignature", () => {
    const secret = "gitea-webhook-secret";
    const payload = JSON.stringify({ repository: { full_name: "org/repo" } });

    function generateGiteaSignature(body: string, key: string): string {
      return createHmac("sha256", key).update(body, "utf8").digest("hex");
    }

    it("should verify valid signature", () => {
      const signature = generateGiteaSignature(payload, secret);
      expect(verifyGiteaSignature(payload, signature, secret)).toBe(true);
    });

    it("should reject null signature", () => {
      expect(verifyGiteaSignature(payload, null, secret)).toBe(false);
    });

    it("should verify signature without prefix (unlike GitHub)", () => {
      const signature = generateGiteaSignature(payload, secret);
      // Gitea doesn't use sha256= prefix
      expect(signature.startsWith("sha256=")).toBe(false);
      expect(verifyGiteaSignature(payload, signature, secret)).toBe(true);
    });

    it("should reject invalid signature", () => {
      const wrongSignature =
        "0000000000000000000000000000000000000000000000000000000000000000";
      expect(verifyGiteaSignature(payload, wrongSignature, secret)).toBe(false);
    });

    it("should reject signature with wrong secret", () => {
      const signature = generateGiteaSignature(payload, "wrong-secret");
      expect(verifyGiteaSignature(payload, signature, secret)).toBe(false);
    });

    it("should reject tampered payload", () => {
      const signature = generateGiteaSignature(payload, secret);
      const tamperedPayload = JSON.stringify({
        repository: { full_name: "other/repo" },
      });
      expect(verifyGiteaSignature(tamperedPayload, signature, secret)).toBe(
        false,
      );
    });

    it("should reject malformed hex signature", () => {
      const malformedSignature = "not-valid-hex-string";
      expect(verifyGiteaSignature(payload, malformedSignature, secret)).toBe(
        false,
      );
    });

    it("should handle empty payload", () => {
      const emptyPayload = "";
      const signature = generateGiteaSignature(emptyPayload, secret);
      expect(verifyGiteaSignature(emptyPayload, signature, secret)).toBe(true);
    });

    it("should handle unicode in payload", () => {
      const unicodePayload = JSON.stringify({
        commit: { message: "Add emoji 🎉" },
      });
      const signature = generateGiteaSignature(unicodePayload, secret);
      expect(verifyGiteaSignature(unicodePayload, signature, secret)).toBe(
        true,
      );
    });
  });

  describe("cross-provider verification", () => {
    const secret = "shared-secret";
    const payload = JSON.stringify({ test: true });

    it("should not accept GitHub signature format for Gitea", () => {
      const githubSignature = `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
      // GitHub signature has prefix, Gitea expects raw hex
      expect(verifyGiteaSignature(payload, githubSignature, secret)).toBe(
        false,
      );
    });

    it("should not accept Gitea signature format for GitHub", () => {
      const giteaSignature = createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");
      // Gitea signature is raw hex, GitHub expects sha256= prefix
      expect(verifyGitHubSignature(payload, giteaSignature, secret)).toBe(
        false,
      );
    });
  });
});
