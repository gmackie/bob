import { describe, expect, it } from "vitest";

import {
  normalizeLinearWebBaseUrl,
  rewriteLinearWebUrl,
} from "../linearUrls.js";

describe("linearUrls", () => {
  it("rewrites linear.app issue URLs to a configured Linear clone domain", () => {
    expect(
      rewriteLinearWebUrl(
        "https://linear.app/gmac/issue/ENG-42/replace-runner?x=1#activity",
        "https://tasks.gmac.io",
      ),
    ).toBe("https://tasks.gmac.io/gmac/issue/ENG-42/replace-runner?x=1#activity");
  });

  it("keeps Linear URLs unchanged when no custom domain is configured", () => {
    expect(
      rewriteLinearWebUrl("https://linear.app/gmac/issue/ENG-42/replace-runner", null),
    ).toBe("https://linear.app/gmac/issue/ENG-42/replace-runner");
  });

  it("normalizes custom domains without deriving an API host", () => {
    expect(normalizeLinearWebBaseUrl("tasks.gmac.io/")).toBe("https://tasks.gmac.io");
  });
});
