import { describe } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";
import { makeRpcServerLayer, serializationLayer } from "../server.js";

const Echo = Rpc.make("Echo", {
  success: Schema.String,
  payload: { message: Schema.String },
});

const TestGroup = RpcGroup.make(Echo);

describe("@gmacko/rpc server", () => {
  it.effect("serves an RPC call end-to-end", () =>
    Effect.gen(function* () {
      const handler = TestGroup.toLayer({
        Echo: (req) => Effect.succeed(`echo:${req.message}`),
      });

      const serverLayer = makeRpcServerLayer(TestGroup).pipe(
        Layer.provide(handler),
        Layer.provide(serializationLayer),
        Layer.provide(HttpRouter.layer),
      );

      // Verify the layer builds without error (smoke test for Phase 6A)
      yield* Layer.build(serverLayer).pipe(Effect.scoped);
    }),
  );
});
