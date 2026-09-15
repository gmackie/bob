import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi, afterEach } from "vitest";
import { trace, context, propagation, diag } from "@opentelemetry/api";
import {
  initTelemetry,
  shutdownTelemetry,
  instrumentHttpServer,
} from "../node";

describe("Node OTLP publishing", () => {
  afterEach(async () => {
    await shutdownTelemetry().catch(() => {});
    trace.disable();
    context.disable();
    propagation.disable();
    diag.disable();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("honors the standard SDK disable switch even with a trace endpoint", () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true");
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      "http://127.0.0.1:1/v1/traces",
    );
    try {
      initTelemetry({ serviceName: "disabled-service" });
      const span = trace.getTracer("test").startSpan("disabled");
      expect(span.isRecording()).toBe(false);
      span.end();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("exports real HTTP and child spans on shutdown with safe metadata", async () => {
    const received: any[] = [];
    const paths: string[] = [];
    const collector = createServer(async (req, res) => {
      paths.push(req.url!);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }).listen(0, "127.0.0.1");
    await once(collector, "listening");
    const port = (collector.address() as { port: number }).port;
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "http://127.0.0.1:1/wrong-general",
    );
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      `http://127.0.0.1:${port}/custom-traces`,
    );
    initTelemetry({
      serviceName: "test-node-service",
      serviceVersion: "test-version",
    });
    const server = createServer(async (_req, res) => {
      await trace
        .getTracer("test")
        .startActiveSpan("nested-work", async (span) => {
          await Promise.resolve();
          span.end();
        });
      res.end("ok");
    }).listen(0, "127.0.0.1");
    instrumentHttpServer(server, ["/health"]);
    instrumentHttpServer(server, ["/health"]);
    await once(server, "listening");
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/health?secret=private`,
        {
          headers: {
            authorization: "Bearer confidential",
            traceparent:
              "00-11111111111111111111111111111111-2222222222222222-01",
          },
        },
      );
      expect(await response.text()).toBe("ok");
      await shutdownTelemetry();
      expect(paths).toEqual(["/custom-traces"]);
      const resources = received.flatMap((body) => body.resourceSpans);
      const spans = resources.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope: any) => scope.spans),
      );
      expect(spans).toHaveLength(2);
      const request = spans.find((span) => span.name === "GET /health");
      const child = spans.find((span) => span.name === "nested-work");
      expect(request.traceId).toBe("11111111111111111111111111111111");
      expect(request.parentSpanId).toBe("2222222222222222");
      expect(child.parentSpanId).toBe(request.spanId);
      expect(resources[0].resource.attributes).toContainEqual({
        key: "service.name",
        value: { stringValue: "test-node-service" },
      });
      expect(JSON.stringify(received)).not.toMatch(
        /private|confidential|secret=/,
      );
    } finally {
      vi.unstubAllEnvs();
      await shutdownTelemetry();
      server.closeAllConnections();
      server.close();
      collector.closeAllConnections();
      collector.close();
    }
  });
  it("reports rejected exports without logging collector credentials", async () => {
    const collector = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* drain upload */
      }
      res.writeHead(400);
      res.end("private collector error");
    }).listen(0, "127.0.0.1");
    await once(collector, "listening");
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      `http://127.0.0.1:${(collector.address() as { port: number }).port}/secret-path`,
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      initTelemetry({ serviceName: "failing-export" });
      trace.getTracer("test").startSpan("export-failure").end();
      await shutdownTelemetry().catch(() => {});
      expect(errors).toHaveBeenCalled();
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /secret-path|private collector/,
      );
    } finally {
      collector.closeAllConnections();
      collector.close();
    }
  });
});
