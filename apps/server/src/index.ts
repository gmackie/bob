import { Effect, Layer } from "effect";
import { RpcServer, RpcSerialization } from "effect/unstable/rpc";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { createServer } from "node:http";

import { GmackoRpcGroup } from "@gmacko/contracts";
import { RpcHandlerLayer } from "./rpc-handler.js";
import { DatabaseServiceLive } from "./services/database.js";
import { AgentServiceLive } from "./services/agent.js";
import { WikiServiceLive } from "./services/wiki.js";

const PORT = Number(process.env.PORT ?? 3001);

// RPC server layer: registers the RPC group routes on HttpRouter
const RpcServerLayer = RpcServer.layerHttp({
  group: GmackoRpcGroup,
  path: "/rpc",
}).pipe(
  Layer.provide(RpcHandlerLayer),
  Layer.provide(DatabaseServiceLive),
  Layer.provide(AgentServiceLive),
  Layer.provide(WikiServiceLive),
  Layer.provide(RpcSerialization.layerJson),
);

// Node.js HTTP server layer
const NodeServerLayer = NodeHttpServer.layer(
  () => createServer(),
  { port: PORT },
);

// Build the HTTP app from the router, which has routes registered by RpcServerLayer
const httpApp = HttpRouter.toHttpEffect(RpcServerLayer);

// Serve the HTTP app
const HttpLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const app = yield* httpApp;
    yield* HttpServer.serveEffect()(app);
    yield* Effect.log(`gmacko server listening on http://localhost:${PORT}`);
  }),
).pipe(
  Layer.provide(NodeServerLayer),
);

// Run the server
Effect.runFork(Layer.launch(HttpLive));
