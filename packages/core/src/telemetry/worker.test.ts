import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapFetch } from "./worker";

const parentTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
const parentSpan = "00f067aa0ba902b7";
let server: Server;
let endpoint: string;
let received: { path: string; body: any; headers: Record<string, unknown> }[];
let reply: (res: import("node:http").ServerResponse) => void;
let pending: Promise<unknown>[];
const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };

beforeEach(async () => {
  received = [];
  pending = [];
  reply = (res) => { res.setHeader("content-type", "application/json"); res.end("{}"); };
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({ path: req.url!, body: JSON.parse(body), headers: req.headers });
    reply(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await Promise.all(pending);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const span = () => received[0]!.body.resourceSpans[0].scopeSpans[0].spans[0];
const request = (traceparent?: string, path = "/api/health") => new Request(`https://app.example${path}`, {
  headers: traceparent ? { traceparent } : {},
});
const options = () => ({ endpoint, serviceName: "bob" });

describe("Worker OTLP export", () => {
  it("publishes a server span to a real HTTP receiver with parent correlation", async () => {
    const response = await wrapFetch(async () => new Response("ok"), options())(
      request(`00-${parentTrace}-${parentSpan}-01`), {}, ctx,
    );
    await Promise.all(pending);
    expect(received[0]!.path).toBe("/v1/traces");
    expect(received[0]!.headers["content-type"]).toBe("application/json");
    expect(span()).toMatchObject({ traceId: parentTrace, parentSpanId: parentSpan, kind: 2 });
    expect(received[0]!.body.resourceSpans[0].resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "bob" } });
    expect(response.headers.get("x-fg-trace")).toBe(parentTrace);
    expect(await response.text()).toBe("ok");
  });

  it("honors an unsampled parent without starting an export", async () => {
    await wrapFetch(async () => new Response("ok"), options())(request(`00-${parentTrace}-${parentSpan}-00`), {}, ctx);
    await Promise.all(pending);
    expect(received).toHaveLength(0);
  });

  it.each([
    `00-${"0".repeat(32)}-${parentSpan}-01`,
    `00-${"g".repeat(32)}-${parentSpan}-01`,
    `00-${parentTrace}-${"0".repeat(16)}-01`,
    `00-${parentTrace}-${parentSpan}-zz`,
    `00-${parentTrace}-${parentSpan}-01-extra`,
  ])("starts a new trace for malformed traceparent %s", async (header) => {
    await wrapFetch(async () => new Response("ok"), options())(request(header), {}, ctx);
    await Promise.all(pending);
    expect(span().parentSpanId).toBeUndefined();
    expect(span().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span().traceId).not.toBe(parentTrace);
  });

  it("keeps the original streaming response and WebSocket upgrade intact", async () => {
    const upstream = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("event: ping\n\n")); } }));
    // Node's Response disallows 101; emulate the CF extension on a real Response.
    Object.defineProperty(upstream, "status", { value: 101 });
    Object.defineProperty(upstream, "webSocket", { value: { protocol: "test" } });
    const response = await wrapFetch(async () => upstream, options())(request(), {}, ctx);
    expect(response).toBe(upstream);
    expect(response.bodyUsed).toBe(false);
    await response.body!.cancel();
  });

  it("preserves even falsy thrown values and excludes error secrets", async () => {
    await expect(wrapFetch(async () => { throw undefined; }, options())(request(), {}, ctx)).rejects.toBeUndefined();
    await Promise.all(pending);
    expect(span().status.code).toBe(2);
  });

  it("reports receiver rejection without logging body or endpoint secrets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.statusCode = 401; res.end("secret-collector-response"); };
    const response = await wrapFetch(async () => new Response("ok"), options())(request(), {}, ctx);
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain("401");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-collector-response");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(endpoint);
  });

  it("reports OTLP partial rejection and never retries it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ partialSuccess: { rejectedSpans: "1", errorMessage: "secret" } })); };
    await wrapFetch(async () => new Response("ok"), options())(request(), {}, ctx);
    await Promise.all(pending);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    expect(received).toHaveLength(1);
  });

  it("redacts token and dynamic route segments and omits queries", async () => {
    await wrapFetch(async () => new Response("ok"), options())(request(undefined, "/api/v1/tts-streams/private-token?token=query-secret"), {}, ctx);
    await Promise.all(pending);
    expect(JSON.stringify(received)).not.toContain("private-token");
    expect(JSON.stringify(received)).not.toContain("query-secret");
    expect(span().name).toBe("GET /api/v1/tts-streams/:id");
  });

  it.each([
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test/prefix/" }, "https://collector.test/prefix/v1/traces"],
    [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.test/custom", OTEL_EXPORTER_OTLP_ENDPOINT: "https://ignored.test" }, "https://collector.test/custom"],
    [{ OTEL_ENDPOINT: "https://collector.test/legacy/" }, "https://collector.test/legacy/v1/traces"],
    [{}, "https://otlp.forgegraf.com/v1/traces"],
  ])("resolves OTLP endpoint settings %j", async (env, expected) => {
    const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", sent);
    await wrapFetch(async () => new Response("ok"), { serviceName: "ooda" })(request(), env, ctx);
    await Promise.all(pending);
    expect(sent.mock.calls[0]?.[0]).toBe(expected);
  });

  it("sends trace-specific percent-encoded OTLP headers", async () => {
    await wrapFetch(async () => new Response("ok"), options())(request(), {
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=ignored",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer%20private%3Dkey,x-project=test",
    }, ctx);
    await Promise.all(pending);
    expect(received[0]!.headers.authorization).toBe("Bearer private=key");
    expect(received[0]!.headers["x-project"]).toBe("test");
  });

  it("retries a transient receiver failure once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.statusCode = received.length === 1 ? 503 : 200; res.end("{}"); };
    await wrapFetch(async () => new Response("ok"), options())(request(), {}, ctx);
    await Promise.all(pending);
    expect(received).toHaveLength(2);
    expect(received[1]!.body).toEqual(received[0]!.body);
  });

  it("bounds a receiver that stalls after response headers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders(); setTimeout(() => res.end("{}"), 150); };
    await wrapFetch(async () => new Response("ok"), options())(request(), { OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: "20" }, ctx);
    await Promise.all(pending);
    expect(JSON.stringify(warn.mock.calls)).toContain("timeout");
  });

  it("rejects oversized collector replies without logging their contents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ignored: "x".repeat(70_000) })); };
    await wrapFetch(async () => new Response("ok"), options())(request(), {}, ctx);
    await Promise.all(pending);
    expect(JSON.stringify(warn.mock.calls)).toContain("response_too_large");
  });

  it("does not mistake a non-OTLP success page for an acknowledgement", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply = (res) => { res.end("<html>secret-sign-in</html>"); };
    await wrapFetch(async () => new Response("ok"), options())(request(), {}, ctx);
    await Promise.all(pending);
    expect(JSON.stringify(warn.mock.calls)).toContain("invalid_response");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-sign-in");
  });

  it("honors a sampled parent even when root sampling is zero", async () => {
    await wrapFetch(async () => new Response("ok"), { ...options(), sampleRate: 0 })(request(`00-${parentTrace}-${parentSpan}-01`), {}, ctx);
    await Promise.all(pending);
    expect(received).toHaveLength(1);
  });

  it("excludes sensitive exception messages while rethrowing the same error", async () => {
    const error = new Error("password=private-error");
    await expect(wrapFetch(async () => { throw error; }, options())(request(), {}, ctx)).rejects.toBe(error);
    await Promise.all(pending);
    expect(JSON.stringify(received)).not.toContain("private-error");
    expect(span().status.code).toBe(2);
  });

  it("does not export when explicitly disabled", async () => {
    const upstream = new Response("ok");
    const response = await wrapFetch(async () => upstream, options())(request(), { OTEL_DISABLED: "true" }, ctx);
    expect(response).toBe(upstream);
    expect(pending).toHaveLength(0);
  });

  it("honors the standard SDK disable setting", async () => {
    await wrapFetch(async () => new Response("ok"), options())(request(), { OTEL_SDK_DISABLED: "true" }, ctx);
    expect(pending).toHaveLength(0);
  });

  it.each([
    [{ FG_STAGE: "staging", NODE_ENV: "production" }, "staging"],
    [{ NODE_ENV: "development" }, "development"],
    [{}, "production"],
  ])("sets deployment environment from Worker bindings %j", async (env, stage) => {
    await wrapFetch(async () => new Response("ok"), options())(request(), env, ctx);
    await Promise.all(pending);
    expect(received[0]!.body.resourceSpans[0].resource.attributes).toContainEqual({ key: "deployment.environment", value: { stringValue: stage } });
  });

  it.each([
    ["/sessions/health", "GET /sessions/:id"],
    ["/api/v1/runs/list/artifacts", "GET /api/v1/runs/:id/artifacts"],
    ["/api/v1/work-items/health/runs", "GET /api/v1/work-items/:id/runs"],
    ["/api/v1/work-items/get", "GET /api/v1/work-items/get"],
    ["/api/v1/tts-streams/health", "GET /api/v1/tts-streams/:id"],
  ])("normalizes known dynamic routes even for dictionary IDs: %s", async (path, name) => {
    await wrapFetch(async () => new Response("ok"), options())(request(undefined, path), {}, ctx);
    await Promise.all(pending);
    expect(span().name).toBe(name);
  });
});
