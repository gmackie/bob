import {
  wrapFetch as instrumentWorker,
  type WorkerTelemetryOptions,
} from "@gmacko/core/telemetry/worker";

// Preserve Bob's legacy one-argument helper while keeping the shared exporter
// explicit about which product owns each span.
export function wrapFetch<
  E extends Record<string, unknown> | undefined,
  C extends { waitUntil(promise: Promise<unknown>): void },
>(
  handler: (request: Request, env: E, ctx: C) => Promise<Response>,
  options: Partial<WorkerTelemetryOptions> = {},
) {
  return instrumentWorker(handler, { ...options, serviceName: options.serviceName ?? "bob" });
}
