import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/api", () => ({
  appRouter: {},
}));

import { GET } from "./route";

describe("/api/openapi route", () => {
  it("defaults to the deployed curated REST routes for this origin", async () => {
    const response = await GET(
      new Request("https://bob.blder.bot/api/openapi"),
    );

    expect(response.status).toBe(200);
    const document = (await response.json()) as any;

    expect(document.servers?.[0]?.url).toBe("https://bob.blder.bot");
    expect(document.paths["/api/v1/work-items/list"]?.post).toBeDefined();
    expect(document.paths["/api/v1/auth/get-session"]).toBeUndefined();
  });

  it("keeps the generated Effect-RPC contract behind an explicit mode", async () => {
    const response = await GET(
      new Request("https://bob.blder.bot/api/openapi?mode=rpc"),
    );

    expect(response.status).toBe(200);
    const document = (await response.json()) as any;

    expect(document.paths["/api/v1/auth/get-session"]).toBeDefined();
  });
});
