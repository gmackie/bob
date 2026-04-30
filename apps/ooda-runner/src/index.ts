import { loadConfig } from "./config";
import { RunnerServer } from "./runner-server";

const config = loadConfig();
const server = new RunnerServer(config);

server.start().catch((err) => {
  console.error("[runner] fatal:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  server.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.stop().then(() => process.exit(0));
});
