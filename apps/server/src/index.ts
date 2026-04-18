import { Effect, Layer } from "effect";
import { RpcServer, RpcSerialization } from "effect/unstable/rpc";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { GmackoRpcGroup } from "@gmacko/contracts";
import { migrate } from "@gmacko/db";
import { RpcHandlerLayer } from "./rpc-handler.js";
import { DatabaseServiceLive } from "./services/database.js";
import { AgentServiceLive } from "./services/agent.js";
import { WikiServiceLive } from "./services/wiki.js";
import { ExplorerServiceLive } from "./services/explorer.js";
import { handleStreamChat } from "./sse.js";

const PORT = Number(process.env.PORT ?? 3001);

// RPC server layer: registers the RPC group routes on HttpRouter
const RpcServerLayer = RpcServer.layerHttp({
  group: GmackoRpcGroup,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(RpcHandlerLayer),
  Layer.provide(DatabaseServiceLive),
  Layer.provide(AgentServiceLive),
  Layer.provide(WikiServiceLive),
  Layer.provide(Layer.provide(ExplorerServiceLive, Layer.merge(AgentServiceLive, WikiServiceLive))),
  Layer.provide(RpcSerialization.layerJson),
);

/**
 * Collect the raw body from a Node IncomingMessage and convert
 * it into a Web-standard Request so the SSE handler can use it.
 */
function nodeReqToWebRequest(req: IncomingMessage): Promise<Request> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = `http://localhost:${PORT}${req.url ?? "/"}`;
      resolve(
        new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "POST" ? body : undefined,
        }),
      );
    });
    req.on("error", reject);
  });
}

/**
 * Pipe a Web Response back through a Node ServerResponse.
 */
async function sendWebResponse(
  webRes: Response,
  nodeRes: ServerResponse,
): Promise<void> {
  nodeRes.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
  }
  nodeRes.end();
}

// Node.js HTTP server with SSE interception for /api/chat/stream
const NodeServerLayer = NodeHttpServer.layer(
  () => {
    const server = createServer();

    // Intercept /api/chat/stream before Effect's HTTP handler processes it.
    // The 'request' listener fires first; if we handle the response ourselves
    // and call res.end(), the Effect handler (which listens on the same event)
    // will see res.writableEnded === true and skip.
    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/api/chat/stream") {
        nodeReqToWebRequest(req)
          .then((webReq) => handleStreamChat(webReq))
          .then((webRes) => sendWebResponse(webRes, res))
          .catch((err) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
            }
            res.end(JSON.stringify({ error: String(err) }));
          });
      }
    });

    return server;
  },
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

// Run schema migration, then start the server
await migrate();
Effect.runFork(Layer.launch(HttpLive));
