// Phase 6F Task 9 — end-to-end smoke test.
//
// Spins up a **real Node HTTP server** inside the test, mounts all 4 stub
// handler Layers via `RpcServer.layerHttp`, creates a real `@gmacko/client`
// pointed at the server's URL, calls one procedure per group, asserts the
// round-trip returns the stub's mock data. Also exercises the streaming path
// via `agent.sendTurn` and consumes 3 events from the async iterable.
//
// Approach — composition + binding:
//   1. **Merge the 4 RpcGroups into one** via `AuthRpc.merge(ProjectsRpc,
//      SecretsRpc, AgentRpc)`. `RpcGroup.merge` widens the resulting group's
//      Rpc type union. Handler layers from each group merge cleanly via
//      `Layer.mergeAll(...)` because each layer provides a disjoint subset of
//      `Rpc.ToHandler<MergedGroup>`. The merged group is mounted on a single
//      `/rpc` path so `createGmackoRpcClient({ baseURL })` points all four
//      facades at the same endpoint.
//
//   2. Bind `HttpRouter.toWebHandler(serverLayer)` (which returns a plain
//      `(Request) => Promise<Response>`) to a Node `http.createServer` via
//      the `buildWebRequest` / `writeWebResponse` helpers below. Effect 4
//      beta doesn't ship a `@effect/platform-node` equivalent in this
//      monorepo, so we hand-roll the Node ↔ WHATWG conversion. Node 18+
//      supplies `Request`/`Response`/`Blob` globally.
//
// Drift notes (new):
//   - `HttpRouter.toWebHandler(appLayer)` takes the app Layer (NOT the
//     router itself) and internally wires `HttpRouter.layer`. Don't
//     pre-provide `HttpRouter.layer` — it's implicit.
//   - `RpcGroup.merge(...groups)` is the documented way to combine groups
//     behind one mount path. Handler composition is via `Layer.mergeAll`.
//   - `RpcServer.layerHttp({ protocol: "http" })` + `RpcSerialization.layerJson`
//     handles streaming by buffering all events server-side and returning
//     them as one JSON array in a single response body (per
//     `RpcServer.js:628-633`, `!includesFraming` branch). That's why a plain
//     POST-response transport works for `agent.sendTurn` without any SSE
//     plumbing. If/when we need true chunked streaming, switch to
//     `RpcSerialization.layerNdjson` on both ends.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { AuthRpc } from "@gmacko/contracts/groups/auth";
import { ProjectsRpc } from "@gmacko/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/contracts/groups/secrets";
import { AgentRpc } from "@gmacko/contracts/groups/agent";
import { stubAuthHandlers } from "@gmacko/contracts/stubs/auth";
import { stubProjectsHandlersLayer } from "@gmacko/contracts/stubs/projects";
import { layerStubSecretsHandlers } from "@gmacko/contracts/stubs/secrets";
import { stubAgentHandlers } from "@gmacko/contracts/stubs/agent";

import { createGmackoRpcClient } from "../index.js";

// --- Server composition ---------------------------------------------------

const MergedRpc = AuthRpc.merge(ProjectsRpc, SecretsRpc, AgentRpc);

const mergedHandlers = Layer.mergeAll(
  stubAuthHandlers,
  stubProjectsHandlersLayer,
  layerStubSecretsHandlers,
  stubAgentHandlers.layer,
);

const serverLayer = RpcServer.layerHttp({
  group: MergedRpc,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(mergedHandlers),
  Layer.provide(RpcSerialization.layerJson),
);

// --- Node HTTP server binding ---------------------------------------------

async function readNodeRequestBody(
  req: import("node:http").IncomingMessage,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function buildWebRequest(
  req: import("node:http").IncomingMessage,
  body: Uint8Array,
  baseURL: string,
): Request {
  const url = new URL(req.url ?? "/", baseURL);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const entry of v) headers.append(k, entry);
    } else if (typeof v === "string") {
      headers.set(k, v);
    }
  }
  const method = req.method ?? "GET";
  const init: RequestInit = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD" && body.byteLength > 0) {
    // `BodyInit` doesn't directly accept Uint8Array<ArrayBufferLike> in this
    // @types/node build; wrap in a Blob for a type-safe BodyInit. Alternative
    // would be `init.body as unknown as BodyInit`, but the Blob path avoids
    // casts.
    init.body = new Blob([new Uint8Array(body)]);
  }
  return new Request(url, init);
}

async function writeWebResponse(
  res: import("node:http").ServerResponse,
  webResp: Response,
): Promise<void> {
  res.statusCode = webResp.status;
  for (const [k, v] of webResp.headers.entries()) {
    res.setHeader(k, v);
  }
  if (!webResp.body) {
    res.end();
    return;
  }
  // Stream the body into the Node response. Node's ServerResponse is a
  // Writable so we iterate the ReadableStream chunks.
  const reader = webResp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

// --- Test lifecycle --------------------------------------------------------

let server: Server;
let baseURL: string;
let disposeHandler: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const { handler, dispose } = HttpRouter.toWebHandler(serverLayer);
  disposeHandler = dispose;

  server = createServer(async (req, res) => {
    try {
      const body = await readNodeRequestBody(req);
      const webReq = buildWebRequest(req, body, "http://127.0.0.1");
      const webResp = await handler(webReq);
      await writeWebResponse(res, webResp);
    } catch (err) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          error: "server-adapter-error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${addr.port}/rpc`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (disposeHandler) {
    await disposeHandler();
  }
});

// --- Tests -----------------------------------------------------------------

describe("@gmacko/client e2e round-trip against stub server", () => {
  it("auth.whoAmI returns the stub user", async () => {
    const client = createGmackoRpcClient({ baseURL });
    const user = await client.auth.whoAmI();
    expect(user).toMatchObject({
      userId: "user_stub_abc",
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: "stub@example.com",
      role: "owner",
    });
  });

  it("projects.list returns 2 stub projects", async () => {
    const client = createGmackoRpcClient({ baseURL });
    const projects = await client.projects.list();
    expect(projects).toHaveLength(2);
    // Sanity: slug + name match the stub fixtures.
    const slugs = projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(["acme", "oodadocs"]);
  });

  it("secrets.list returns 2 stub envelopes (no plaintext/ciphertext)", async () => {
    const client = createGmackoRpcClient({ baseURL });
    const secrets = await client.secrets.list();
    expect(secrets).toHaveLength(2);
    for (const envelope of secrets) {
      expect(envelope).not.toHaveProperty("plaintext");
      expect(envelope).not.toHaveProperty("ciphertext");
      expect(envelope).not.toHaveProperty("iv");
      expect(envelope).not.toHaveProperty("authTag");
    }
    const names = secrets.map((s) => s.name).sort();
    expect(names).toEqual(["GITHUB_TOKEN", "OPENAI_API_KEY"]);
  });

  it("agent.sendTurn streams 3 events for the stub conversation", async () => {
    const client = createGmackoRpcClient({ baseURL });
    const STUB_CONVERSATION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const events: unknown[] = [];
    for await (const evt of client.agent.sendTurn({
      conversationId: STUB_CONVERSATION_ID,
      prompt: "hi",
    })) {
      events.push(evt);
    }
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "session_init" });
    expect(events[1]).toMatchObject({ type: "text_delta", text: "you said: hi" });
    expect(events[2]).toMatchObject({ type: "turn_end" });
  });
});
