import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

let sdk: NodeSDK | null = null;

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  /** OTLP endpoint. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT env var. */
  endpoint?: string;
  /** Disable telemetry entirely (e.g. in tests). */
  disabled?: boolean;
}

export function initTelemetry(config: TelemetryConfig): void {
  if (sdk) return;

  const endpoint =
    config.endpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    process.env.SIGNOZ_ENDPOINT;

  if (config.disabled || !endpoint) {
    console.log(`[telemetry] disabled (no endpoint configured)`);
    return;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion ?? "0.0.0",
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });

  sdk.start();
  console.log(`[telemetry] initialized → ${endpoint} (service=${config.serviceName})`);

  const shutdown = async () => {
    await sdk?.shutdown();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
