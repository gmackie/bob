import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINEAR_WEB_BASE_URL,
  normalizeLinearWebBaseUrl,
  rewriteLinearWebUrl,
} from "../linearUrls.js";

describe("linear URL helpers", () => {
  it("defaults blank clone domains to linear.app", () => {
    expect(normalizeLinearWebBaseUrl(null)).toBe(DEFAULT_LINEAR_WEB_BASE_URL);
    expect(normalizeLinearWebBaseUrl("   ")).toBe(DEFAULT_LINEAR_WEB_BASE_URL);
  });

  it("normalizes a custom clone domain without a trailing slash", () => {
    expect(normalizeLinearWebBaseUrl("https://tasks.gmac.io/")).toBe(
      "https://tasks.gmac.io",
    );
  });

  it("rewrites linear.app URLs to a custom clone domain while preserving path, query, and hash", () => {
    expect(
      rewriteLinearWebUrl(
        "https://linear.app/gmac/issue/ENG-42/fix-dispatch?tab=comments#activity",
        "https://tasks.gmac.io",
      ),
    ).toBe("https://tasks.gmac.io/gmac/issue/ENG-42/fix-dispatch?tab=comments#activity");
  });

  it("leaves URLs unchanged when no custom clone domain is configured", () => {
    const url = "https://linear.app/gmac/issue/ENG-42/fix-dispatch";
    expect(rewriteLinearWebUrl(url, null)).toBe(url);
  });

  it("does not rewrite non-Linear URLs", () => {
    const url = "https://github.com/example/repo/pull/42";
    expect(rewriteLinearWebUrl(url, "https://tasks.gmac.io")).toBe(url);
  });
});
