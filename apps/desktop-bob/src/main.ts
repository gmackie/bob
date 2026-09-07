import { desktopSessionPartition, preserveSupervisorTitle } from "./window-session.js";
import { serverStartupTimeout } from "@bob/server/startup-timeout";
import { app, BrowserWindow, dialog } from "electron";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import type { Writable } from "node:stream";
import { terminateProcessTree, killProcessTreeNow } from "@bob/server/process-tree";
import { readDesktopMode, verifyConnectedDesktop, daemonConfig, daemonArgs, daemonEnvironment, type ConnectedDesktop } from "./connection.js";
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

const BASE_DIR = path.resolve(process.env.BOB_DESKTOP_DATA_DIR ?? path.join(os.homedir(), ".bob"));
if (process.env.BOB_DESKTOP_DATA_DIR) app.setPath("userData", path.join(BASE_DIR, "browser"));
const USERDATA_DIR = path.join(BASE_DIR, "userdata");
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
let daemonConfigDir: string | undefined;
let upstreamProcessGroupId: number | undefined;

type ServerReady = { url: string; token: string };

async function spawnBobServer(roots: string[]): Promise<ServerReady> {
  const token = crypto.randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [
      BOB_SERVER_BIN,
      "--base-dir",
      BASE_DIR,
      "--port",
      "0",
      "--host",
      "127.0.0.1",
      "--bootstrap-fd",
      "3",
      ...roots.flatMap((root) => ["--filesystem-root", root]),
      "--no-browser",
    ],
    {
      cwd: SERVER_CWD,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        BOB_BLDER_DIR: app.isPackaged
          ? path.join(process.resourcesPath, "blder")
          : process.env.BOB_DESKTOP_DEV === "1" ? path.join(APP_ROOT, "apps", "bob")
          : path.resolve(process.env.BOB_NODE_APP_DIR ?? path.join(APP_ROOT, "apps", "desktop-bob", ".node-app")),
        BOB_DB_MIGRATIONS_DIR: app.isPackaged
          ? path.join(process.resourcesPath, "db-migrations")
          : path.join(APP_ROOT, "packages", "bob", "src", "db", "drizzle"),
      },
    },
  );
  (child.stdio[3] as Writable).end(JSON.stringify({ authToken: token }));
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
    const timer = setTimeout(() => { cleanup(); reject(new Error("bob-server did not become ready")); }, serverStartupTimeout() + 5_000);
    const onError = () => { cleanup(); reject(new Error("bob-server could not be launched")); };
    const cleanup = () => {
      clearTimeout(timer);
      stdoutRl.off("line", onReadyLine);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onReadyLine = (line: string) => {
      try {
        const parsed = JSON.parse(line) as { ready?: boolean; url?: string; upstreamProcessGroupId?: number };
        if (parsed.ready === true && typeof parsed.url === "string" && new URL(parsed.url).hostname === "127.0.0.1" &&
            Number.isSafeInteger(parsed.upstreamProcessGroupId) && parsed.upstreamProcessGroupId! > 1) {
          upstreamProcessGroupId = parsed.upstreamProcessGroupId;
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
    child.once("error", onError);
  });

  // Always mirror stdout to the log sink in parallel with the ready detector.
  stdoutRl.on("line", (line) => {
    logLine("bob-server", line);
    process.stdout.write(`[bob-server] ${line}\n`);
  });

  try { return await readyPromise; } catch (error) { await terminateProcessTree(child); throw error; }
}

async function spawnDaemon(config: ConnectedDesktop): Promise<void> {
  const resolution = resolveDaemonBinaryPath({ platform: process.platform, arch: os.arch(), binDir: DAEMON_BIN_DIR });
  if (resolution.kind !== "found") {
    throw new Error("A compatible bundled Bob daemon is required for connected execution; rebuild or reinstall the desktop package");
  }
  const devDir = await realpath(config.devDir);
  await mkdir(USERDATA_DIR, { recursive: true, mode: 0o700 });
  daemonConfigDir = await mkdtemp(path.join(USERDATA_DIR, "desktop-run-"));
  const configPath = path.join(daemonConfigDir, "config.json");
  await writeFile(configPath, daemonConfig({ ...config, devDir }), { mode: 0o600 });
  // Foreground start lets Electron own the entire process group. `daemon
  // start` double-forks and writes the user's global daemon.pid/config lane.
  const child = spawn(resolution.path, daemonArgs({ ...config, devDir }, configPath), {
    cwd: devDir, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: daemonEnvironment(config, process.env),
  });
  daemonChild = child;
  pipeChildLogs("bob-daemon", child);
  await new Promise<void>((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout! });
    const timer = setTimeout(() => finish(new Error("Bob daemon did not confirm its gateway connection")), 30_000);
    const onExit = () => finish(new Error("Bob daemon exited before connecting"));
    const onError = () => finish(new Error("Bob daemon could not be launched"));
    const finish = (error?: Error) => {
      clearTimeout(timer); lines.close(); child.off("exit", onExit); child.off("error", onError);
      error ? reject(error) : resolve();
    };
    child.once("exit", onExit); child.once("error", onError);
    lines.on("line", (line) => {
      if (line.includes("[bob] connected to gateway")) finish();
      if (line.includes("gateway connection failed")) finish(new Error("Bob daemon could not authenticate with its configured gateway"));
    });
  }).catch(async (error) => { await terminateProcessTree(child); throw error; });
  child.on("exit", () => {
    if (!shuttingDown) {
      win?.setTitle("Bob — execution disconnected");
      dialog.showErrorBox("Execution disconnected", "The Bob daemon exited. Restart the desktop app to reconnect; queued work has not been marked completed.");
    }
  });
}

app.whenReady().then(async () => {
  const mode = readDesktopMode(process.env);
  const local = mode.kind === "local" ? await spawnBobServer(mode.roots) : undefined;
  win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: desktopSessionPartition(mode),
    },
  });
  preserveSupervisorTitle(win);
  if (mode.kind === "local") {
    await win.loadURL(`${local!.url}/?t=${local!.token}`);
    win.setTitle("Bob — local mode, execution unavailable");
    await dialog.showMessageBox(win, { type: "info", title: "Local mode", message: "Host execution is unavailable in local mode.", detail: "This window uses its own local database. To run agents, configure connected mode with the Bob app, gateway, workspace and API credential. Connected mode opens that same app and data rather than sending local tasks to a different server. See the desktop connection settings in PACKAGING.md." });
  } else {
    await win.loadURL(mode.appUrl);
    win.setTitle("Bob — verifying execution connection");
    try {
      await verifyConnectedDesktop(mode);
      await spawnDaemon(mode);
      win.setTitle("Bob — connected");
    } catch (error) {
      win.setTitle("Bob — execution blocked");
      await dialog.showMessageBox(win, { type: "error", title: "Execution blocked", message: error instanceof Error ? error.message : "Execution connection failed", detail: "Sign in to this Bob app with the configured workspace owner. Check the connected app, gateway and credential settings, then restart. No local database is used in connected mode." });
    }
  }
}).catch(async (error) => {
  dialog.showErrorBox("Bob startup failed", error instanceof Error ? error.message : "Startup failed");
  await shutdownChildren();
  app.quit();
});

// bob-server needs its own 3s TERM + 2s KILL drain before this supervisor exits.
const SHUTDOWN_GRACE_MS = 7_000;

async function killChildGracefully(label: string, child: ChildProcess | null): Promise<void> {
  await terminateProcessTree(child, { graceMs: SHUTDOWN_GRACE_MS, onSignal: (signal) => logLine("desktop", `${signal} ${label} pid=${child?.pid ?? "?"}`) });
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
    if (upstreamProcessGroupId) await terminateProcessTree(upstreamProcessGroupId, { graceMs: 100 });
  } finally {
    if (daemonConfigDir) await rm(daemonConfigDir, { recursive: true, force: true });
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
  if (upstreamProcessGroupId) { try { killProcessTreeNow(upstreamProcessGroupId); } catch {} }
  for (const [label, child] of [
    ["bob-server", serverChild],
    ["bob-daemon", daemonChild],
  ] as const) {
    if (child) {
      try {
        killProcessTreeNow(child);
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
