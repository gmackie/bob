import os from "node:os";
import path from "node:path";
import { Command } from "commander";

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
  // Full startup flow added in Task 6.
  console.log(JSON.stringify({ parsed: args }));
}
