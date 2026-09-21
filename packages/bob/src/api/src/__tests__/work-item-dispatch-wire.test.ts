import { AuthMiddleware } from "@gmacko/core/auth";
import { GmackoDb } from "@gmacko/core/db";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { TRPCError } from "@trpc/server";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AgentRunHandlers from "../handlers/agentRun.js";
import type * as SessionHandlers from "../handlers/session.js";
import type * as WorkItemHandlers from "../handlers/workItems.js";
import type { RpcServerLayers } from "../rpc-server";
import { createBobRpcClient } from "../../../../../bob-client/src/index";
import { makeRpcHandler } from "../rpc-server";

vi.mock("@bob/db/client", () => ({ db: {} }));
const { dispatch, update, listRuns, getEvents } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  listRuns: vi.fn(),
  getEvents: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../handlers/workItems.js", async (original) => ({
  ...(await original<typeof WorkItemHandlers>()),
  workItemsDispatch: dispatch,
  workItemsUpdate: update,
}));

vi.mock("../handlers/agentRun.js", async (original) => ({
  ...(await original<typeof AgentRunHandlers>()),
  agentRunListByWorkItem: listRuns,
}));
vi.mock("../handlers/session.js", async (original) => ({
  ...(await original<typeof SessionHandlers>()),
  sessionGetEvents: getEvents,
}));

const handler = makeRpcHandler({
  runtimeLayer: Layer.succeed(
    GmackoDb,
    {} as never,
  ) as unknown as RpcServerLayers["runtimeLayer"],
  authMiddlewareLayer: Layer.succeed(AuthMiddleware, (effect) =>
    Effect.provideService(effect, CurrentUser, { userId: "user-1" } as never),
  ) as unknown as RpcServerLayers["authMiddlewareLayer"],
});
const client = createBobRpcClient({
  baseURL: "http://bob.test/api/rpc",
  fetch: (input, init) => handler(new Request(input, init)),
});

describe("work-item actions through the production Effect HTTP assembly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatch.mockResolvedValue({
      sessionId: "session-1",
      identifier: "TASK-1",
      status: "pending",
    });
    update.mockResolvedValue(null);
  });

  it.each(["runs", "events"] as const)(
    "encodes missing %s as a declared error for the outcome panel",
    async (kind) => {
      const error = new TRPCError({ code: "NOT_FOUND" });
      listRuns.mockRejectedValue(error);
      getEvents.mockRejectedValue(error);
      const result =
        kind === "runs"
          ? client.agent.run.listByWorkItem({ workItemId: "item-1" })
          : client.agent.session.getEvents({ sessionId: "session-1" });
      await expect(result).rejects.toMatchObject({ _tag: "NotFoundError" });
    },
  );

  it("preserves the work item, agent and persona and returns the session to navigate to", async () => {
    const input = {
      workItemId: "item-1",
      agentType: "codex",
      personaId: "persona-1",
    };
    await expect(client.workItems.dispatch(input)).resolves.toEqual({
      sessionId: "session-1",
      identifier: "TASK-1",
      status: "pending",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      input,
    );
  });

  it.each(["NOT_FOUND", "FORBIDDEN", "TOO_MANY_REQUESTS"] as const)(
    "delivers %s failures as declared errors, without a schema defect",
    async (code) => {
      dispatch.mockRejectedValue(
        new TRPCError({ code, message: "Cannot dispatch this work" }),
      );
      await expect(
        client.workItems.dispatch({ workItemId: "item-1" }),
      ).rejects.toMatchObject({
        _tag:
          code === "NOT_FOUND"
            ? "BobNotFoundError"
            : code === "FORBIDDEN"
              ? "BobForbiddenError"
              : "BobConflictError",
      });
    },
  );

  it.each(["codex", null])(
    "preserves the agent override update %s",
    async (agentTypeOverride) => {
      const input = { id: "item-1", agentTypeOverride };
      await client.workItems.update(input);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1" }),
        input,
      );
    },
  );
});
