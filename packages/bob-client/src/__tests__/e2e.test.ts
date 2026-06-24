import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import {
  ExternalRpc,
  PlanningRpc,
  WorkItemsRpc,
} from "@gmacko/bob/contracts";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";
import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";
import { ExternalStubLayer } from "../../../bob/src/contracts/stubs/external.js";
import { PlanningStubLayer } from "../../../bob/src/contracts/stubs/planning.js";
import { WorkItemsStubLayer } from "../../../bob/src/contracts/stubs/work-items.js";
import { createBobRpcClient } from "../index.js";

const STUB_DATE = new Date("2026-01-01T00:00:00.000Z");

const MergedBobRpc = WorkItemsRpc.merge(
  PlanningRpc,
  ExternalRpc,
  AgentRpc,
  ProjectsRpc,
  SettingsRpc,
  SecretsRpc,
  AuthRpc,
);

const mergedHandlers = Layer.mergeAll(
  WorkItemsStubLayer,
  PlanningStubLayer,
  ExternalStubLayer,
  AgentRpc.toLayer({
    "agent.run.list": () => Effect.succeed([]),
  } as any),
  ProjectsRpc.toLayer({
    "projects.list": () =>
      Effect.succeed([
        {
          id: "stub-project-1",
          tenantId: "stub-tenant-1",
          slug: "alpha",
          name: "Alpha",
          createdAt: STUB_DATE,
          updatedAt: STUB_DATE,
        },
        {
          id: "stub-project-2",
          tenantId: "stub-tenant-1",
          slug: "beta",
          name: "Beta",
          createdAt: STUB_DATE,
          updatedAt: STUB_DATE,
        },
      ]),
  } as any),
  SettingsRpc.toLayer({
    "settings.getPreferences": () =>
      Effect.succeed({
        userId: "user_settings_stub",
        theme: "dark",
      }),
  } as any),
  SecretsRpc.toLayer({
    "secrets.list": () => Effect.succeed([]),
  } as any),
  AuthRpc.toLayer({
    "auth.getSession": () =>
      Effect.succeed({
        user: { id: "user_stub_abc" },
      }),
  } as any),
);

const serverLayer = RpcServer.layerHttp({
  group: MergedBobRpc,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(mergedHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
);

async function readNodeRequestBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function buildWebRequest(
  req: IncomingMessage,
  body: Uint8Array,
  baseURL: string,
): Request {
  const url = new URL(req.url ?? "/", baseURL);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.byteLength > 0) {
    init.body = new Blob([new Uint8Array(body)]);
  }
  return new Request(url, init);
}

async function writeWebResponse(
  res: ServerResponse,
  webResponse: Response,
): Promise<void> {
  res.statusCode = webResponse.status;
  for (const [key, value] of webResponse.headers.entries()) {
    res.setHeader(key, value);
  }

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
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

let server: Server;
let baseURL: string;
let disposeHandler: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const { handler, dispose } = HttpRouter.toWebHandler(serverLayer as never);
  disposeHandler = dispose;

  server = createServer(async (req, res) => {
    try {
      const body = await readNodeRequestBody(req);
      const webRequest = buildWebRequest(req, body, "http://127.0.0.1");
      const webResponse = await (handler as (request: Request) => Promise<Response>)(
        webRequest,
      );
      await writeWebResponse(res, webResponse);
    } catch (error) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          error: "server-adapter-error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${address.port}/rpc`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (disposeHandler) {
    await disposeHandler();
  }
});

describe("@gmacko/bob-client e2e round-trip against Effect stub server", () => {
  it("calls one read method per Bob RPC group over HTTP", async () => {
    const client = createBobRpcClient({ baseURL });

    await expect(client.workItems.notification.list({})).resolves.toEqual({
      items: [],
    });
    await expect(client.planning.listWorkspaces()).resolves.toEqual([]);
    await expect(client.external.webhook.list({})).resolves.toEqual([]);
    await expect(
      client.agent.run.list({ workspaceId: "stub-ws-1" }),
    ).resolves.toEqual([]);
    await expect(client.projects.list()).resolves.toHaveLength(2);
    await expect(client.settings.getPreferences()).resolves.toMatchObject({
      userId: "user_settings_stub",
      theme: "dark",
    });
    await expect(client.secrets.list()).resolves.toEqual([]);
    await expect(client.auth.getSession()).resolves.toMatchObject({
      user: { id: "user_stub_abc" },
    });
  });
});
