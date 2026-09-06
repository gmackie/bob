import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** apps/bob-server/dist/blder-spawn.js → ../../bob */
const DEFAULT_BLDER_DIR = path.resolve(__dirname, "../../bob");

export type BlderLaunchSpec = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
};

export function resolveBlderDir(): string {
  return process.env.BOB_BLDER_DIR ?? DEFAULT_BLDER_DIR;
}

export function resolveNodeExecutable(): string {
  return process.env.BOB_NODE ?? process.execPath;
}

export function resolveVinextCli(blderDir: string): string {
  if (process.env.BOB_VINEXT_CLI) {
    return process.env.BOB_VINEXT_CLI;
  }
  return path.join(blderDir, "node_modules", "vinext", "dist", "cli.js");
}

export function buildBlderLaunchSpec(options: {
  port: number;
  host?: string;
  useDev: boolean;
  blderDir?: string;
}): BlderLaunchSpec {
  const blderDir = options.blderDir ?? resolveBlderDir();
  const host = options.host ?? "127.0.0.1";
  // Vinext's emitted index is a request handler, not an executable server.
  // Its production adapter owns HTTP listening and static/RSC asset serving.
  const args = [resolveVinextCli(blderDir), options.useDev ? "dev" : "start",
    "--port", String(options.port), "--hostname", host];

  return {
    executable: resolveNodeExecutable(),
    args,
    cwd: blderDir,
  };
}
