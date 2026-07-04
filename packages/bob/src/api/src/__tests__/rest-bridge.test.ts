import { describe, expect, it } from "vitest";
import type { Layer as LayerType } from "effect";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";

import { makeRestBridge, restPathToTag } from "../rest-bridge.js";

// A tiny RPC group + handler with no DB/auth, so we can exercise the full
// in-process REST → RPC → REST round-trip the bridge performs.
const EchoRpc = Rpc.make("echo.say", {
  payload: Schema.Struct({ msg: Schema.String }),
  success: Schema.Struct({ echoed: Schema.String }),
});
const AddRpc = Rpc.make("math.add", {
  payload: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Struct({ sum: Schema.Number }),
});
const TestGroup = RpcGroup.make(EchoRpc, AddRpc);

const handlers = TestGroup.toLayer({
  "echo.say": ({ msg }: { msg: string }) => Effect.succeed({ echoed: msg }),
  "math.add": ({ a, b }: { a: number; b: number }) =>
    Effect.succeed({ sum: a + b }),
} as never);

const serverLayer = RpcServer.layerHttp({
  group: TestGroup,
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcSerialization.layerNdjson),
);

const { handler: rpcHandler } = HttpRouter.toWebHandler(serverLayer);

const bridge = makeRestBridge(TestGroup, rpcHandler);

const post = (path: string, body: unknown) =>
  bridge(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("restPathToTag", () => {
  it("reverses tagToRestPath", () => {
    expect(restPathToTag("/api/v1/echo/say")).toBe("echo.say");
    expect(restPathToTag("/api/v1/work-item/link/list")).toBe(
      "workItem.link.list",
    );
  });
  it("returns undefined outside the base path", () => {
    expect(restPathToTag("/api/rpc")).toBeUndefined();
    expect(restPathToTag("/api/v1/")).toBeUndefined();
  });
});

describe("makeRestBridge (in-process dispatch)", () => {
  it("dispatches a REST POST through the real RPC handler", async () => {
    const res = await post("/api/v1/echo/say", { msg: "hello" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: "hello" });
  });

  it("round-trips a second operation", async () => {
    const res = await post("/api/v1/math/add", { a: 2, b: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sum: 5 });
  });

  it("404s an unknown operation", async () => {
    const res = await post("/api/v1/nope/missing", {});
    expect(res.status).toBe(404);
  });

  it("405s a non-POST request", async () => {
    const res = await bridge(
      new Request("http://localhost/api/v1/echo/say", { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });

  it("400s an invalid JSON body", async () => {
    const res = await bridge(
      new Request("http://localhost/api/v1/echo/say", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
