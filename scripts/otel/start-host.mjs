// Package beside telemetry-node.cjs; retain the existing host application's runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import telemetry from "./telemetry-node.cjs";

const [runtimePath, portText, host] = process.argv.slice(2);
const port = Number(portText);
if (!runtimePath || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Usage: start-host.mjs <runtime-directory> <port> <host>");
}
if (process.env.BOB_DESKTOP_LOCAL_AUTH === "1") {
  throw new Error("Desktop local auth is not valid for the hosted service");
}
const runtime = resolve(runtimePath);
process.chdir(process.env.BOB_HOST_APP_CWD || "/opt/bob-gmacko/apps/bob");
telemetry.initTelemetry({ serviceName: "bob-host" });
const { startProdServer } = await import(pathToFileURL(
  resolve(runtime, "node_modules/vinext/dist/server/prod-server.js"),
).href);
const { server } = await startProdServer({ port, host, outDir: resolve(runtime, "dist") });
telemetry.instrumentHttpServer(server, ["/api/health", "/login", "/api/auth/get-session"]);

let stopping;
function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    const force = setTimeout(() => server.closeAllConnections(), 10000);
    force.unref();
    await new Promise((done) => server.close(done));
    clearTimeout(force);
    await telemetry.shutdownTelemetry();
  })();
  return stopping;
}
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    void stop().then(() => process.exit(0), () => process.exit(1));
  });
}
