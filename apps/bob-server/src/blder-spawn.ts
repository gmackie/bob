import fs from "node:fs";
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

function resolveBlderEntryScript(blderDir: string, useDev: boolean): string {
  if (useDev) {
    return resolveVinextCli(blderDir);
  }

  const appRouterEntry = path.join(blderDir, "dist", "server", "index.js");
  const pagesRouterEntry = path.join(blderDir, "dist", "server", "entry.js");
  if (fs.existsSync(appRouterEntry)) {
    return appRouterEntry;
  }
  if (fs.existsSync(pagesRouterEntry)) {
    return pagesRouterEntry;
  }

  // Fall back to vinext start when dist layout is unknown (e.g. during dev builds).
  return resolveVinextCli(blderDir);
}

export function buildBlderLaunchSpec(options: {
  port: number;
  host?: string;
  useDev: boolean;
  blderDir?: string;
}): BlderLaunchSpec {
  const blderDir = options.blderDir ?? resolveBlderDir();
  const host = options.host ?? "127.0.0.1";
  const entryScript = resolveBlderEntryScript(blderDir, options.useDev);
  const usesVinextCli = entryScript.endsWith(
    `${path.sep}vinext${path.sep}dist${path.sep}cli.js`,
  );

  const args = usesVinextCli
    ? [
        entryScript,
        options.useDev ? "dev" : "start",
        "--port",
        String(options.port),
        "--hostname",
        host,
      ]
    : [entryScript];

  return {
    executable: resolveNodeExecutable(),
    args,
    cwd: blderDir,
  };
}
