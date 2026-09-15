import { createServer } from "node:http";
import { once } from "node:events";
import { context, trace, propagation, diag } from "@opentelemetry/api";
import { afterEach, expect, it, vi } from "vitest";
import { initTelemetry, shutdownTelemetry } from "../node";
import {
  captureTraceCarrier,
  getTraceReference,
  withTraceSpan,
  tracedFetch,
} from "../deep";
let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  await shutdownTelemetry();
  trace.disable();
  context.disable();
  propagation.disable();
  diag.disable();
  vi.unstubAllEnvs();
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
});
it("Node SDK exports linked attempts, child calls and failure without request data", async () => {
  const spans: any[] = [];
  let parent: string | undefined;
  server = createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    if (req.url === "/v1/traces")
      spans.push(...JSON.parse(b).resourceSpans[0].scopeSpans[0].spans);
    else parent = req.headers.traceparent as string;
    res.end("{}");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
  initTelemetry({ serviceName: "runner" });
  const carrier = {
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  };
  let ref: any;
  await expect(
    withTraceSpan(
      "job.attempt",
      async () => {
        ref = getTraceReference();
        expect(captureTraceCarrier()).toBeDefined();
        await tracedFetch(
          endpoint + "/private?secret=x",
          {},
          { service: "bob", baseUrl: endpoint },
        );
        throw new Error("private prompt");
      },
      {
        carrier,
        link: true,
        kind: "consumer",
        attributes: { "job.id": "job-1" },
      },
    ),
  ).rejects.toThrow("private prompt");
  await shutdownTelemetry();
  const attempt = spans.find((s) => s.name === "job.attempt"),
    client = spans.find((s) => s.name === "bob.http");
  expect(attempt.traceId).toBe(ref.traceId);
  expect(attempt.links[0]).toMatchObject({
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222",
  });
  expect(client.parentSpanId).toBe(attempt.spanId);
  expect(parent).toBe(`00-${ref.traceId}-${client.spanId}-01`);
  expect(attempt.status.code).toBe(2);
  expect(JSON.stringify(spans)).not.toMatch(/private|prompt|secret/);
});
it("unsampled linked attempts retain unique attempt identity without exporting", async () => {
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");
  initTelemetry({ serviceName: "runner" });
  const carrier = {
    traceparent: "00-11111111111111111111111111111111-2222222222222222-00",
  };
  const refs: any[] = [];
  for (let i = 0; i < 2; i++)
    await withTraceSpan(
      "job.attempt",
      async () => {
        refs.push(getTraceReference());
      },
      { carrier, link: true, kind: "consumer" },
    );
  expect(refs[0].sampled).toBe(false);
  expect(refs[0].traceId).not.toBe("11111111111111111111111111111111");
  expect(refs[0].spanId).not.toBe(refs[1].spanId);
});
