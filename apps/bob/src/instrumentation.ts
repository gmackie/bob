export async function register() {
  const { initializeIntegrationConfig } = await import("@bob/config/integrations");
  initializeIntegrationConfig();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@gmacko/core/telemetry/node");
    initTelemetry({ serviceName: "bob" });
  }
}
