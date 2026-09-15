import { once } from "node:events";
import { createServer } from "node:http";
import {
  initTelemetry,
  shutdownTelemetry,
  traceHttpRequest,
} from "@gmacko/core/telemetry/node";
import * as Sentry from "@sentry/node";
import { expect, it, vi } from "vitest";

import { initNodeObservability, shutdownNodeObservability } from "./node";

interface ExportedSpan {
  name: string;
  traceId: string;
  parentSpanId?: string;
}
interface TracePayload {
  resourceSpans: { scopeSpans: { spans: ExportedSpan[] }[] }[];
}

it("publishes OTLP spans with Sentry enabled and still delivers Sentry errors", async () => {
  const traces: TracePayload[] = [];
  const errors: string[] = [];
  const collector = createServer((req, res) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (req.url === "/v1/traces")
        traces.push(JSON.parse(body) as TracePayload);
      else errors.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    })();
  }).listen(0, "127.0.0.1");
  await once(collector, "listening");
  const port = (collector.address() as { port: number }).port;
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${port}`);
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", undefined);
  initNodeObservability({
    serviceName: "sentry-otel-test",
    environment: "test",
    sentry: {
      enabled: true,
      dsn: `http://public@127.0.0.1:${port}/1`,
      tracesSampleRate: 1,
    },
    posthog: { enabled: false, host: "http://127.0.0.1" },
  });
  initTelemetry({ serviceName: "sentry-otel-test" });
  const handler = traceHttpRequest(
    (_req, res) => {
      Sentry.captureException(new Error("test-sentry-error-marker"));
      res.end("ok");
    },
    ["/health"],
  );
  const server = createServer((req, res) => {
    void handler(req, res);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/health?private-query-marker=private-value`,
      {
        headers: {
          traceparent:
            "00-11111111111111111111111111111111-2222222222222222-01",
        },
      },
    );
    expect(await response.text()).toBe("ok");
    await Sentry.flush(2_000);
    await shutdownTelemetry();
    const spans = traces.flatMap((body) =>
      body.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );
    const request = spans.find((span) => span.name === "GET /health");
    expect(request).toBeDefined();
    expect(spans).toHaveLength(1);
    expect(JSON.stringify(traces)).not.toContain("private-query-marker");
    expect(request?.traceId).toBe("11111111111111111111111111111111");
    expect(request?.parentSpanId).toBe("2222222222222222");
    expect(
      errors.some((body) => body.includes("test-sentry-error-marker")),
    ).toBe(true);
  } finally {
    await shutdownTelemetry();
    await shutdownNodeObservability();
    server.closeAllConnections();
    server.close();
    collector.closeAllConnections();
    collector.close();
    vi.unstubAllEnvs();
  }
}, 10_000);
