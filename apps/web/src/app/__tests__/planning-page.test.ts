import { describe, expect, it } from "vitest";

describe("planning page", () => {
  it("exports a default client component", async () => {
    const module = await import("../(dashboard)/planning/page");
    expect(typeof module.default).toBe("function");
    // The component is now a client component with no props (uses hooks internally)
    expect(module.default.length).toBe(0);
  });
});
