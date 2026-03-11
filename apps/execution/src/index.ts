import { spawn, type ChildProcess } from "node:child_process";

import {
  getExecutionServiceConfig,
  type ExecutionChildProcessConfig,
} from "./config.js";

function startChild(config: ExecutionChildProcessConfig): ChildProcess {
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.log(`[execution] ${config.name} exited with ${reason}`);
    process.exitCode = code ?? 0;
  });

  child.on("error", (error) => {
    console.error(`[execution] ${config.name} failed to start`, error);
    process.exitCode = 1;
  });

  return child;
}

async function main(): Promise<void> {
  const config = getExecutionServiceConfig();
  const children: ChildProcess[] = [];

  if (config.gateway.enabled) {
    console.log("[execution] starting gateway child process");
    children.push(startChild(config.gateway));
  } else {
    console.log("[execution] gateway child process disabled");
  }

  if (children.length === 0) {
    console.log("[execution] no runtime children enabled; exiting");
    return;
  }

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`[execution] received ${signal}; forwarding shutdown`);
    for (const child of children) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>((resolve) => {
    let exited = 0;
    for (const child of children) {
      child.once("exit", () => {
        exited += 1;
        if (exited === children.length) {
          resolve();
        }
      });
    }
  });
}

main().catch((error) => {
  console.error("[execution] fatal error", error);
  process.exit(1);
});
