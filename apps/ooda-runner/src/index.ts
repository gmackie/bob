import { initTelemetry, shutdownTelemetry } from "@gmacko/core/telemetry/node";
import { startInferenceServer } from "./inference-server";
import { loadConfig } from "./config";
import { RunnerServer } from "./runner-server";

initTelemetry({ serviceName: "ooda-runner" });
const config = loadConfig();
const server = new RunnerServer(config);
let inference: ReturnType<typeof startInferenceServer> | undefined;
let stopping = false;
async function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  inference?.close();
  inference?.closeAllConnections();
  try {
    await server.stop();
  } catch (error) {
    console.error("[runner] shutdown failed:", error);
    exitCode = 1;
  } finally {
    try { await shutdownTelemetry(); }
    catch { console.error("[telemetry] shutdown failed"); }
    process.exit(exitCode);
  }
}
server.start().then(() => {
  inference = startInferenceServer(server, config);
  inference.on("error", error => {
    console.error("[runner] inference listener failed:", error);
    void stop(1);
  });
}).catch(error => {
  console.error("[runner] fatal:", error);
  void stop(1);
});
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
