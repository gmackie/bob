import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { RotatingFileSink } from "./rotatingFileSink.js";

// apps/desktop/dist-electron/main.js → ../../.. lands at the monorepo root.
const APP_ROOT = path.resolve(__dirname, "../../..");

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
const BOB_SERVER_BIN = path.join(
  APP_ROOT,
  "apps",
  "bob-server",
  "dist",
  "bin.js",
);
// Go daemon binary bundled under apps/desktop/resources/bin/.
// dist-electron/main.js → ../resources/bin.
const DAEMON_BIN_DIR = path.resolve(__dirname, "..", "resources", "bin");

let serverChild: ChildProcess | null = null;
let daemonChild: ChildProcess | null = null;
let win: BrowserWindow | null = null;

type ServerReady = { url: string; token: string };

async function spawnBobServer(): Promise<ServerReady> {
  const token = crypto.randomBytes(32).toString("hex");
  const child = spawn(
    "node",
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
      cwd: APP_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
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

function resolveDaemonBinaryPath(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  const binPath = path.join(DAEMON_BIN_DIR, `bob-darwin-${arch}`);
  if (!fs.existsSync(binPath)) {
    return null;
  }
  return binPath;
}

function spawnDaemon(serverUrl: string, token: string): void {
  const binPath = resolveDaemonBinaryPath();
  if (!binPath) {
    console.warn(
      `[desktop] bob daemon binary not found under ${DAEMON_BIN_DIR} for arch ${os.arch()} — skipping daemon spawn`,
    );
    return;
  }

  // The Go CLI reads config from ~/.config/bob/config.yaml — it does not yet
  // accept --server-url / --auth-token flags. We still pass BOB_SERVER_URL /
  // BOB_AUTH_TOKEN through the env so a future daemon build can pick them up
  // without touching Electron. For now the daemon will start but will not
  // usefully contact the local bob-server until the Go CLI grows flag support.
  const child = spawn(binPath, ["daemon", "start"], {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BOB_SERVER_URL: serverUrl,
      BOB_AUTH_TOKEN: token,
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverChild?.kill("SIGTERM");
  daemonChild?.kill("SIGTERM");
});
