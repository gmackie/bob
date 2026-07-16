import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  resolveDaemonBinaryPath,
  resolveDesktopPaths,
} from "./packaging.js";
import { RotatingFileSink } from "./rotatingFileSink.js";

const DESKTOP_PATHS = resolveDesktopPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  electronDir: __dirname,
});
const { appRoot: APP_ROOT, bobServerBin: BOB_SERVER_BIN, daemonBinDir: DAEMON_BIN_DIR, serverCwd: SERVER_CWD } =
  DESKTOP_PATHS;

const USERDATA_DIR = path.join(os.homedir(), ".bob", "userdata");
const LOG_DIR = path.join(USERDATA_DIR, "logs");
const LOG_PATH = path.join(LOG_DIR, "main.log");
const LOG_MAX_BYTES = 10 * 1024 * 1024;
const LOG_MAX_FILES = 10;

const logSink = new RotatingFileSink({
  filePath: LOG_PATH,
  maxBytes: LOG_MAX_BYTES,
  maxFiles: LOG_MAX_FILES,
});

function logLine(source: string, line: string): void {
  const stamp = new Date().toISOString();
  logSink.writeLine(`${stamp} [${source}] ${line}`);
}

function pipeChildLogs(source: string, child: ChildProcess): void {
  if (child.stdout) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      logLine(source, line);
      process.stdout.write(`[${source}] ${line}\n`);
    });
  }
  if (child.stderr) {
    const rl = readline.createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      logLine(`${source}.err`, line);
      process.stderr.write(`[${source}] ${line}\n`);
    });
  }
}
let serverChild: ChildProcess | null = null;
let daemonChild: ChildProcess | null = null;
let win: BrowserWindow | null = null;

type ServerReady = { url: string; token: string };

async function spawnBobServer(): Promise<ServerReady> {
  const token = crypto.randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [
      BOB_SERVER_BIN,
      "--port",
      "0",
      "--host",
      "127.0.0.1",
      "--auth-token",
      token,
      "--no-browser",
    ],
    {
      cwd: SERVER_CWD,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        BOB_BLDER_DIR: app.isPackaged
          ? path.join(process.resourcesPath, "blder")
          : path.join(APP_ROOT, "apps", "bob"),
        BOB_DB_MIGRATIONS_DIR: app.isPackaged
          ? path.join(process.resourcesPath, "db-migrations")
          : path.join(APP_ROOT, "packages", "bob", "src", "db", "drizzle"),
      },
    },
  );
  serverChild = child;
  logLine("bob-server", `spawned pid=${child.pid ?? "?"}`);

  if (!child.stdout) {
    throw new Error("bob-server child has no stdout");
  }

  // We need to watch stdout for the JSON ready line AND mirror the whole
  // stream (plus stderr) into the rotating log sink. Attach two listeners
  // to the same readline on stdout, one for ready detection, one for logging.
  const stdoutRl = readline.createInterface({ input: child.stdout });
  if (child.stderr) {
    const stderrRl = readline.createInterface({ input: child.stderr });
    stderrRl.on("line", (line) => {
      logLine("bob-server.err", line);
      process.stderr.write(`[bob-server] ${line}\n`);
    });
  }

  const readyPromise = new Promise<ServerReady>((resolve, reject) => {
    const cleanup = () => {
      stdoutRl.off("line", onReadyLine);
      child.off("exit", onExit);
    };
    const onReadyLine = (line: string) => {
      try {
        const parsed = JSON.parse(line) as { ready?: boolean; url?: string };
        if (parsed.ready === true && typeof parsed.url === "string") {
          cleanup();
          resolve({ url: parsed.url, token });
        }
      } catch {
        // Non-JSON log output is fine — keep waiting for the ready line.
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `bob-server exited before ready (code=${code}, signal=${signal})`,
        ),
      );
    };
    stdoutRl.on("line", onReadyLine);
    child.once("exit", onExit);
  });

  // Always mirror stdout to the log sink in parallel with the ready detector.
  stdoutRl.on("line", (line) => {
    logLine("bob-server", line);
    process.stdout.write(`[bob-server] ${line}\n`);
  });

  return await readyPromise;
}

function spawnDaemon(serverUrl: string, token: string): void {
  const resolution = resolveDaemonBinaryPath({
    platform: process.platform,
    arch: os.arch(),
    binDir: DAEMON_BIN_DIR,
  });

  if (resolution.kind === "unsupported-platform") {
    console.warn(
      `[desktop] bob daemon is not supported on ${resolution.platform} — skipping daemon spawn`,
    );
    return;
  }

  if (resolution.kind === "missing") {
    console.warn(
      `[desktop] bob daemon binary not found at ${resolution.expectedPath} — skipping daemon spawn`,
    );
    return;
  }

  const binPath = resolution.path;
  // The Go CLI (github.com/blder/bob) honors BOB_SERVER_URL / BOB_AUTH_TOKEN /
  // BOB_GATEWAY_URL env vars at runtime (internal/config/config.go), so we can
  // point the bundled daemon at Electron's local bob-server without touching
  // ~/.config/bob/config.yaml on disk.
  //
  // Derive a ws:// gateway URL from the http:// server URL. In Phase 2's
  // proxy-through-bob-server model the WS endpoint is served by the same
  // host/port; the spawned bob-server's HTTP server upgrades WS requests
  // that match the session-relay path. A cleaner split lands in Phase 3.
  const wsUrl = serverUrl.replace(/^http(s?):\/\//, "ws$1://") + "/sessions";
  const child = spawn(binPath, ["daemon", "start"], {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BOB_SERVER_URL: serverUrl,
      BOB_AUTH_TOKEN: token,
      BOB_GATEWAY_URL: wsUrl,
    },
  });
  daemonChild = child;
  logLine("bob-daemon", `spawned pid=${child.pid ?? "?"} bin=${binPath}`);

  pipeChildLogs("bob-daemon", child);

  child.on("exit", (code, signal) => {
    logLine(
      "bob-daemon",
      `exited code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
  });
}

app.whenReady().then(async () => {
  const devMode = process.env.BOB_DESKTOP_DEV === "1";
  logLine(
    "desktop",
    `electron ready — mode=${devMode ? "dev (blder HMR via vinext)" : "start (prebuilt blder)"} logs=${LOG_PATH}`,
  );
  const { url, token } = await spawnBobServer();
  spawnDaemon(url, token);

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`${url}/?t=${token}`);
});

const SHUTDOWN_GRACE_MS = 3_000;

async function killChildGracefully(
  label: string,
  child: ChildProcess | null,
): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;
  logLine("desktop", `SIGTERM ${label} pid=${child.pid ?? "?"}`);
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        logLine(
          "desktop",
          `SIGKILL ${label} pid=${child.pid ?? "?"} (grace elapsed)`,
        );
        try {
          child.kill("SIGKILL");
        } catch {
          // best-effort
        }
      }
      resolve();
    }, SHUTDOWN_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let shuttingDown = false;
async function shutdownChildren(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.all([
      killChildGracefully("bob-server", serverChild),
      killChildGracefully("bob-daemon", daemonChild),
    ]);
  } finally {
    logSink.close();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  void shutdownChildren().finally(() => {
    // Re-issue the quit so Electron can proceed now that children are down.
    app.quit();
  });
});

// POSIX signals from the parent (e.g. terminal Ctrl-C when launched via
// `pnpm start`) — tear down children before the process dies.
process.once("SIGINT", () => {
  void shutdownChildren().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void shutdownChildren().finally(() => process.exit(143));
});

// Last-resort synchronous kill — `exit` cannot await, so we best-effort
// SIGKILL both children so zombies do not survive a hard crash.
process.on("exit", () => {
  for (const [label, child] of [
    ["bob-server", serverChild],
    ["bob-daemon", daemonChild],
  ] as const) {
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // best-effort
      }
      // No-op if sink is closed; still a best-effort trace.
      try {
        logSink.writeLine(
          `${new Date().toISOString()} [desktop] exit handler SIGKILL ${label} pid=${child.pid ?? "?"}`,
        );
      } catch {
        // best-effort
      }
    }
  }
});
