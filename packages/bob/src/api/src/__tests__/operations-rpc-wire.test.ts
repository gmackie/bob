import { AuthMiddleware } from "@gmacko/core/auth";
import { GmackoDb } from "@gmacko/core/db";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcServerLayers } from "../rpc-server.js";
import { createBobQueryClient } from "../../../../../bob-client/src/query.js";
import { makeRpcHandler } from "../rpc-server.js";

vi.mock("@bob/db/client", () => ({ db: {} }));
const mocks = vi.hoisted(() => ({ budget: vi.fn(), messages: vi.fn() }));
vi.mock("../handlers/cockpitControls.js", async (original) => ({
  ...(await original<typeof import("../handlers/cockpitControls.js")>()),
  controlSetBudget: mocks.budget,
}));
vi.mock("../handlers/planSession.js", async (original) => ({
  ...(await original<typeof import("../handlers/planSession.js")>()),
  planSessionListMessages: mocks.messages,
}));
const workspace = vi.fn();
const handler = makeRpcHandler({
  runtimeLayer: Layer.succeed(GmackoDb, {
    query: { workspaces: { findFirst: workspace } },
  } as never) as unknown as RpcServerLayers["runtimeLayer"],
  authMiddlewareLayer: Layer.succeed(AuthMiddleware, (effect) =>
    Effect.provideService(effect, CurrentUser, {
      userId: "user-1",
      gatewayToken: "validated-session-token",
    } as never),
  ) as unknown as RpcServerLayers["authMiddlewareLayer"],
});
const rpc = createBobQueryClient({
  baseURL: "http://bob.test/api/rpc",
  fetch: (input, init) => handler(new Request(input, init)),
});
const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("operator and live workflow Effect HTTP paths", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns the validated gateway credential through the real session handler", async () => {
    expect(
      await rpc("agent.session.getGatewayWebSocketUrl").call(undefined),
    ).toMatchObject({
      userId: "user-1",
      token: "validated-session-token",
    });
  });
  it("preserves budget payloads and authenticated handler context", async () => {
    mocks.budget.mockResolvedValue({ dailyCap: 50, concurrency: 4 });
    expect(
      await rpc("cockpit.setBudget").call({ dailyCap: 50, concurrency: 4 }),
    ).toEqual({ dailyCap: 50, concurrency: 4 });
    expect(mocks.budget).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      { dailyCap: 50, concurrency: 4 },
    );
  });
  it("keeps collaborative message data across the wire", async () => {
    const messages = [
      {
        id: "message-1",
        sessionId: workspaceId,
        userId: "user-1",
        clientMessageId: null,
        body: "Review this",
        createdAt: "2026-09-16",
        userName: null,
        userImage: null,
      },
    ];
    mocks.messages.mockResolvedValue(messages);
    expect(
      await rpc("planning.session.listMessages").call({
        sessionId: workspaceId,
      }),
    ).toEqual(messages);
  });
  it("enforces workspace ownership before relaying credential actions", async () => {
    workspace.mockResolvedValue({
      id: workspaceId,
      ownerUserId: "another-user",
    });
    await expect(
      rpc("agentAuth.start").call({
        workspaceId,
        provider: "codex",
        requestId: "request-1",
      }),
    ).rejects.toMatchObject({ _tag: "BobForbiddenError" });
    workspace.mockResolvedValue(undefined);
    await expect(
      rpc("agentAuth.cancel").call({ workspaceId, requestId: "request-1" }),
    ).rejects.toMatchObject({ _tag: "BobNotFoundError" });
  });
});
