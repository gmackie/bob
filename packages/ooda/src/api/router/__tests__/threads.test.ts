import { describe, expect, it } from "vitest";

import { CreateResearchThreadSchema } from "@gmacko/ooda/db/schema";

describe("CreateResearchThreadSchema", () => {
  it("validates a valid thread creation input", () => {
    const result = CreateResearchThreadSchema.parse({
      title: "Improve Sleep Quality",
      slug: "improve-sleep-quality",
      domainPackId: "general-research",
      status: "active",
    });

    expect(result.title).toBe("Improve Sleep Quality");
    expect(result.slug).toBe("improve-sleep-quality");
  });

  it("rejects invalid slug", () => {
    expect(() =>
      CreateResearchThreadSchema.parse({
        title: "Test",
        slug: "HAS SPACES",
      }),
    ).toThrow();
  });

  it("accepts thread without optional fields", () => {
    const result = CreateResearchThreadSchema.parse({
      title: "Minimal Thread",
      slug: "minimal-thread",
    });

    expect(result.domainPackId).toBeUndefined();
  });
});
