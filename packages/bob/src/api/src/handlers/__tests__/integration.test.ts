import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@trpc/server", () => ({
  TRPCError: class TRPCError extends Error {
    code: string;
    constructor(input: { code: string; message?: string }) {
      super(input.message ?? input.code);
      this.code = input.code;
    }
  },
}));

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@bob/db/schema", () => ({
  workspaceIntegrations: {
    id: "workspaceIntegrations.id",
    workspaceId: "workspaceIntegrations.workspaceId",
    provider: "workspaceIntegrations.provider",
  },
  workspaceMembers: {
    id: "workspaceMembers.id",
    workspaceId: "workspaceMembers.workspaceId",
    userId: "workspaceMembers.userId",
  },
}));

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn(),
}));

import { integrationGet, integrationList, integrationSave } from "../integration.js";
import type { HandlerContext } from "../context.js";

describe("integration handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The chainable db fake (insert/values/update/set/where/delete all return
  // `this`-equivalent via mockReturnThis) doesn't — and can't reasonably —
  // implement drizzle's full fluent builder surface. createCtx() returns it
  // twice: once cast to the real HandlerContext (for passing into handler
  // calls) and once as its own honest raw shape (for assertions like
  // `rawDb.values` below), so no `any` is needed at either use site.
  function createCtx(input: {
    existingIntegration?: Record<string, unknown> | null;
    integrations?: Record<string, unknown>[];
  }) {
    const query = {
      workspaceMembers: {
        findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
      },
      workspaceIntegrations: {
        findFirst: vi.fn().mockResolvedValue(input.existingIntegration ?? null),
        findMany: vi.fn().mockResolvedValue(input.integrations ?? []),
      },
    };
    const rawDb = {
      query,
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "integration-1" }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };
    const ctx: HandlerContext = {
      db: rawDb as unknown as HandlerContext["db"],
      userId: "user-1",
    };
    return { ctx, rawDb };
  }

  it("saves linearWebBaseUrl for Linear integrations", async () => {
    const { ctx, rawDb } = createCtx({});

    await integrationSave(ctx, {
      workspaceId: "workspace-1",
      provider: "linear",
      linearWebBaseUrl: "https://tasks.gmac.io",
    });

    expect(rawDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ linearWebBaseUrl: "https://tasks.gmac.io" }),
    );
  });

  it("exposes linearWebBaseUrl from get and list responses", async () => {
    const integration = {
      id: "integration-1",
      provider: "linear",
      enabled: true,
      apiKey: "lin_key",
      webhookSigningSecret: null,
      linearTeamId: "team-1",
      linearWebBaseUrl: "https://tasks.gmac.io",
      createdAt: "2026-06-04T00:00:00.000Z",
    };

    const { ctx: getCtx } = createCtx({ existingIntegration: integration });
    await expect(
      integrationGet(getCtx, { workspaceId: "workspace-1", provider: "linear" }),
    ).resolves.toMatchObject({ linearWebBaseUrl: "https://tasks.gmac.io" });

    const { ctx: listCtx } = createCtx({ integrations: [integration] });
    await expect(integrationList(listCtx, { workspaceId: "workspace-1" })).resolves.toEqual([
      expect.objectContaining({ linearWebBaseUrl: "https://tasks.gmac.io" }),
    ]);
  });
});
