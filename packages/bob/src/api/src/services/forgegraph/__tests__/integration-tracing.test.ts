import { once } from "node:events";
import { createServer } from "node:http";
import { wrapFetch } from "@gmacko/core/telemetry/worker";
import { afterEach, expect, it, vi } from "vitest";

import { createTracedLinearClient } from "../../integrations/tracedLinearClient";
import { ForgeGraphClient } from "../forgeGraphClient";
import { clearIdCache, resolveForgeGraphId } from "../idResolver";

let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  clearIdCache();
  server?.closeAllConnections();
  const closing = server;
  if (closing) await new Promise<void>((r) => closing.close(() => r()));
});
it("propagates a distinct client span for each ForgeGraph retry and SDK GraphQL request", async () => {
  const spans: {kind:number;traceId:string;spanId:string;status:{code:number}}[] = [];
  const headers: string[] = [];
  let calls = 0;
  server = createServer((req, res) => {
    void (async () => {
    let b = "";
    for await (const c of req) b += c;
    if (req.url === "/v1/traces") {
      const payload=JSON.parse(b) as {resourceSpans:{scopeSpans:{spans:typeof spans}[]}[]};
      spans.push(...(payload.resourceSpans[0]?.scopeSpans[0]?.spans??[]));
      res.end("{}");
      return;
    }
    headers.push(String(req.headers.traceparent));
    expect(req.headers.authorization).toBe("Bearer private-key");
    if (req.url === "/graphql") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({ data: { viewer: { id: "user-1", name: "Test" } } }),
      );
      return;
    }
    calls++;
    res.statusCode = calls === 1 ? 503 : 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ apps: [] }));
    })().catch(() => { res.statusCode=500;res.end("{}"); });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const pending: Promise<unknown>[] = [];
  await wrapFetch(
    async () => {
      expect(
        await new ForgeGraphClient({
          baseUrl: base,
          apiToken: "private-key",
          timeoutMs: 2000,
        }).listApps(),
      ).toEqual([]);
      const sdk = createTracedLinearClient({
        accessToken: "private-key",
        apiUrl: base + "/graphql",
      });
      expect((await sdk.viewer).id).toBe("user-1");
      return new Response("ok");
    },
    { serviceName: "bob", endpoint: base },
  )(
    new Request("https://bob.example/", {
      headers: {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      },
    }),
    {},
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending);
  const clients = spans.filter((s) => s.kind === 3);
  expect(clients).toHaveLength(3);
  expect(clients[0]?.status.code).toBe(2);
  expect(new Set(headers).size).toBe(3);
  for (const h of headers)
    expect(clients.some((s) => h === `00-${s.traceId}-${s.spanId}-01`)).toBe(
      true,
    );
  expect(JSON.stringify(spans)).not.toMatch(/private-key|viewer/);
});

it("resolves the external-ID object contract before posting a trace and handles a missing mapping", async () => {
  const requests: string[] = [];
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/fg/work-items?externalId=bob-owned-item") {
      res.end(JSON.stringify({ id: "fg-owned-item", externalId: "bob-owned-item" }));
    } else if (req.url === "/api/fg/work-items?externalId=missing") {
      res.end("null");
    } else if (req.url === "/api/fg/work-items") {
      res.end(JSON.stringify([{ id: "fg-owned-item" }]));
    } else if (req.url === "/api/fg/work-items/fg-owned-item/traces" && req.method === "POST") {
      res.end(JSON.stringify({ recorded: true }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new ForgeGraphClient({ baseUrl, apiToken: "fixture-key", timeoutMs: 2000 });
  const id = await resolveForgeGraphId(client, "bob-owned-item");
  expect(id).toBe("fg-owned-item");
  if (!id) throw new Error("Missing fixture mapping");
  await client.recordTrace(id, {
    taskRunId: "task-1", attemptId: "attempt-1", traceId: "1".repeat(32),
    rootSpanId: "2".repeat(16), outcome: "success", captureState: "pending", services: ["bob"],
  });
  await expect(resolveForgeGraphId(client, "missing")).resolves.toBeNull();
  await expect(client.listWorkItems()).resolves.toEqual([{ id: "fg-owned-item" }]);
  expect(requests).toContain("POST /api/fg/work-items/fg-owned-item/traces");
});

it("bounds optional dispatch mapping and does not retry failures", async () => {
  const requests: string[] = [];
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url?.includes("externalId=unavailable")) {
      res.statusCode = 503;
      res.end("unavailable");
    }
    // Other requests deliberately never respond: the caller must abort.
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new ForgeGraphClient({ baseUrl, apiToken: "fixture-key", timeoutMs: 15_000 });
  await expect(client.getWorkItemByExternalId("unavailable", { retry: false, timeoutMs: 100 })).rejects.toThrow("503");
  await expect(client.getWorkItemByExternalId("slow", { repositoryId: "owned-repo", retry: false, timeoutMs: 25 })).rejects.toThrow();
  expect(requests).toEqual(["/api/fg/work-items?externalId=unavailable", "/api/fg/work-items?externalId=slow&repositoryId=owned-repo"]);
});
