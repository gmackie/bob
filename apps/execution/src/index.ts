import { spawn, type ChildProcess } from "node:child_process";

import { type ExecutionChildProcessConfig } from "./config";
import { runExecutionService } from "./runtime";

function startChild(config: ExecutionChildProcessConfig): ChildProcess {
  return spawn(config.command, config.args, {
    cwd: config.cwd,
    env: process.env,
    stdio: "inherit",
  });
}

runExecutionService({ startChild }).catch((error) => {
  console.error("[execution] fatal error", error);
  process.exit(1);
});
