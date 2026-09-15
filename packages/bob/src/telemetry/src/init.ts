// Compatibility entrypoint; runtime initialization belongs to shared infrastructure.
export {
  initTelemetry,
  shutdownTelemetry,
  flushTelemetry,
  type TelemetryConfig,
} from "@gmacko/core/telemetry/node";
