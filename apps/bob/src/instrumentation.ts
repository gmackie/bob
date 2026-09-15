export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@gmacko/core/telemetry/node");
    initTelemetry({ serviceName: "bob" });
  }
}
