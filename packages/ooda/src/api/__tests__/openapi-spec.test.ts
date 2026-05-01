import { describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));

describe("OODA OpenAPI spec generation", () => {
  it("generates a valid OpenAPI document", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.openapi).toBeDefined();
    expect(doc.info.title).toBe("OODA Research API");
    expect(doc.info.version).toBe("0.1.0");
  });

  it("includes security schemes for session and runner auth", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(doc.components?.securitySchemes).toHaveProperty("runnerAuth");
  });

  it("accepts custom baseUrl", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument({
      baseUrl: "https://ooda.blder.bot",
    });

    expect(doc.servers?.[0]?.url).toBe("https://ooda.blder.bot");
  });
});
