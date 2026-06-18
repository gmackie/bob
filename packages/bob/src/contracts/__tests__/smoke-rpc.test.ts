import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcServer, RpcSerialization } from "effect/unstable/rpc";
import { Schema } from "effect";

const PingRpc = Rpc.make("ping", {
  payload: Schema.Void,
  success: Schema.Struct({ pong: Schema.Boolean }),
});

const PingGroup = RpcGroup.make(PingRpc);

describe("Effect-RPC smoke", () => {
  it("can build a server layer from an RpcGroup", () => {
    const handlers = PingGroup.toLayer({
      ping: () => Effect.succeed({ pong: true }),
    });

    const serverLayer = RpcServer.layerHttp({
      group: PingGroup,
      path: "/api/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide(handlers),
      Layer.provide(RpcSerialization.layerNdjson),
    );

    expect(serverLayer).toBeDefined();
  });
});
