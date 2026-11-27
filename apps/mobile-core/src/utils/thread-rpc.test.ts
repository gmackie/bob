import { Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";
import {
  ExplorationListRpc,
  ExplorationRespondRpc,
  ThreadsListRpc,
} from "@gmacko/core/contracts";
import { expect, it, vi } from "vitest";
import { createThreadRpc } from "./thread-rpc";

it("loads real thread/check-in RPC envelopes and encodes a redirect for the selected check-in", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const branchId = "22222222-2222-4222-8222-222222222222";
  const runId = "33333333-3333-4333-8333-333333333333";
  const checkInId = "44444444-4444-4444-8444-444444444444";
  const checkIn = {
    id: checkInId,
    explorationId: runId,
    summary: "Review findings",
    suggestedDirections: [],
    articlesWritten: [],
    depth: 1,
    status: "awaiting_input" as const,
  };
  const summary = {
    id: runId,
    threadId: id,
    topic: "Field notes",
    status: "awaiting_input" as const,
    articlesWrittenCount: 0,
    depth: 1,
    lastCheckIn: Option.some(checkIn),
  };
  const received = vi.fn();
  const group = RpcGroup.make(
    ThreadsListRpc,
    ExplorationListRpc,
    ExplorationRespondRpc,
  );
  const handlers = group.toLayer({
    "threads.list": () =>
      Effect.succeed([
        {
          id,
          title: "Research",
          status: "active",
          activeBranchId: branchId,
          tags: [],
          createdAt: "2026-10-01",
          updatedAt: "2026-10-02",
        },
      ]),
    "exploration.list": () => Effect.succeed([summary]),
    "exploration.respond": (input) => {
      received(input);
      return Effect.succeed(summary);
    },
  });
  const server = HttpRouter.toWebHandler(
    RpcServer.layerHttp({ group, path: "/rpc", protocol: "http" }).pipe(
      Layer.provide(handlers),
      Layer.provide(RpcSerialization.layerJson),
    ),
  );
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    server.handler(new Request(input, init)),
  );
  try {
    const rpc = createThreadRpc("http://core.test/rpc");
    expect((await rpc.threads.list())[0]?.activeBranchId).toBe(branchId);
    expect((await rpc.exploration.list())[0]?.lastCheckIn).toEqual(checkIn);
    await rpc.exploration.respond({
      explorationId: runId,
      checkInId,
      direction: "redirect",
      redirectTopic: "Costs",
    });
    expect(received).toHaveBeenCalledWith({
      explorationId: runId,
      checkInId,
      direction: "redirect",
      redirectTopic: Option.some("Costs"),
    });
  } finally {
    vi.unstubAllGlobals();
    await server.dispose();
  }
});
