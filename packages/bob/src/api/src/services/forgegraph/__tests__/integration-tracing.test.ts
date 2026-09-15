import { once } from "node:events";
import { createServer } from "node:http";
import { wrapFetch } from "@gmacko/core/telemetry/worker";
import { afterEach, expect, it, vi } from "vitest";

import { createTracedLinearClient } from "../../integrations/tracedLinearClient";
import { ForgeGraphClient } from "../forgeGraphClient";

let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
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
