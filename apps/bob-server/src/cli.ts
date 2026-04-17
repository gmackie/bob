import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { openFdStream, readBootstrapEnvelope } from "./bootstrap.js";
import { startServer } from "./server.js";

export type CliArgs = {
  port: number;
  host: string;
  authToken: string | undefined;
  bootstrapFd: number | undefined;
  noBrowser: boolean;
  baseDir: string;
};

export function parseArgs(argv: string[]): CliArgs {
  const program = new Command()
    .name("bob-server")
    .option(
      "--port <number>",
      "HTTP port (0 = random free)",
      (v) => parseInt(v, 10),
      0,
    )
    .option("--host <address>", "Bind address", "127.0.0.1")
    .option("--auth-token <token>", "Bearer token required for all requests")
    .option(
      "--bootstrap-fd <fd>",
      "Read auth-token JSON envelope from inherited FD",
      (v) => parseInt(v, 10),
    )
    .option(
      "--base-dir <path>",
      "Persistence dir",
      path.join(os.homedir(), ".bob"),
    )
    .option("--no-browser", "Do not auto-open browser on start")
    .allowExcessArguments(false)
    .exitOverride();

  program.parse(argv);
  const opts = program.opts();

  return {
    port: typeof opts.port === "number" ? opts.port : 0,
    host: typeof opts.host === "string" ? opts.host : "127.0.0.1",
    authToken:
      typeof opts.authToken === "string" ? opts.authToken : undefined,
    bootstrapFd:
      typeof opts.bootstrapFd === "number" ? opts.bootstrapFd : undefined,
    // commander inverts --no-browser into opts.browser=false
    noBrowser: opts.browser === false,
    baseDir:
      typeof opts.baseDir === "string"
        ? opts.baseDir
        : path.join(os.homedir(), ".bob"),
  };
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  let authToken = args.authToken;
  if (args.bootstrapFd !== undefined) {
    const envelope = await readBootstrapEnvelope(openFdStream(args.bootstrapFd));
    authToken = envelope.authToken ?? authToken;
  }
  if (!authToken && args.host !== "127.0.0.1" && args.host !== "localhost") {
    throw new Error(
      "--auth-token (or --bootstrap-fd) is required when --host is not loopback",
    );
  }
  const resolvedToken = authToken ?? crypto.randomBytes(32).toString("hex");

  const { url, stop } = await startServer({ ...args, authToken: resolvedToken });

  // Emit the ready line in a single JSON object so Electron can parse it.
  console.log(JSON.stringify({ ready: true, url, authToken: resolvedToken }));

  const shutdown = async (signal: NodeJS.Signals) => {
    console.error(`[bob-server] received ${signal}, shutting down`);
    try {
      await stop();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  if (!args.noBrowser) {
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    const { spawn } = await import("node:child_process");
    spawn(opener, [`${url}/?t=${resolvedToken}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}
