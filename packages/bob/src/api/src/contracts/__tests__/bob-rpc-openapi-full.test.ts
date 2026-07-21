import { describe, expect, it } from "vitest";

import {
  generateBobRpcApiDocument,
  BOB_RPC_GROUPS,
} from "../../openapi.js";

describe("generateBobRpcApiDocument (all groups)", () => {
  it("generates over every group without throwing", () => {
    expect(() => generateBobRpcApiDocument()).not.toThrow();
  });

  it("covers every procedure across all groups", () => {
    const doc = generateBobRpcApiDocument({ baseUrl: "https://bob.blder.bot" });
    const opCount = Object.values(doc.paths ?? {}).filter(
      (p) => (p as { post?: unknown }).post,
    ).length;
    const rpcCount = BOB_RPC_GROUPS.reduce(
      (n, g) => n + g.requests.size,
      0,
    );
    expect(opCount).toBe(rpcCount);
    // 8 groups, ~308 procedures (server-internal HealthRpc excluded).
    expect(opCount).toBeGreaterThanOrEqual(300);
  });

  it("tags one entry per group", () => {
    const doc = generateBobRpcApiDocument();
    const tagNames = (doc.tags ?? []).map((t) => t.name).sort();
    expect(tagNames).toContain("workItem");
    expect(tagNames).toContain("planning");
    expect(tagNames).toContain("agent");
  });
});
