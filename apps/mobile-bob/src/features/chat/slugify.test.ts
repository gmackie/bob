import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it("converts title to kebab-case slug", () => {
    expect(slugify("Auth Migration Research")).toBe("auth-migration-research");
  });

  it("strips special characters", () => {
    expect(slugify("What's the plan?!")).toBe("what-s-the-plan");
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(64);
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });
});
