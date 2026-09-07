import { startInferenceServer } from "./inference-server";
import { loadConfig } from "./config";
import { RunnerServer } from "./runner-server";

const config = loadConfig();
const server = new RunnerServer(config);

let inference: ReturnType<typeof startInferenceServer> | undefined;
server
  .start()
  .then(() => {
    inference = startInferenceServer(server, config);
    inference.on("error", (error) => {
      console.error("[runner] inference listener failed:", error);
      void server.stop().finally(() => process.exit(1));
    });
  })
  .catch((err) => {
    console.error("[runner] fatal:", err);
    process.exit(1);
  });

process.on("SIGINT", () => {
  inference?.close();
  inference?.closeAllConnections();
  server.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  inference?.close();
  inference?.closeAllConnections();
  server.stop().then(() => process.exit(0));
});
