import { describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));

describe("OODA OpenAPI spec generation", () => {
  it("generates a valid OpenAPI document", async () => {
    // The first dynamic import of "../openapi" in this file pays the cost of
    // resolving its full dependency graph, which can exceed vitest's default
    // 5000ms timeout under CI's parallel workspace load (observed in CI run
    // #41 on master). Give it more headroom.
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.openapi).toBeDefined();
    expect(doc.info.title).toBe("OODA Research API");
    expect(doc.info.version).toBe("0.1.0");
  }, 15000);

  it("includes security schemes for session and runner auth", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(doc.components?.securitySchemes).toHaveProperty("runnerAuth");
  }, 15000);

  it("accepts custom baseUrl", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument({
      baseUrl: "https://ooda.blder.bot",
    });

    expect(doc.servers?.[0]?.url).toBe("https://ooda.blder.bot");
  });
});
