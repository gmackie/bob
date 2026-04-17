import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// apps/desktop/dist-electron/main.js → ../../.. lands at the monorepo root.
const APP_ROOT = path.resolve(__dirname, "../../..");
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
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env },
    },
  );
  serverChild = child;

  if (!child.stdout) {
    throw new Error("bob-server child has no stdout");
  }

  const rl = readline.createInterface({ input: child.stdout });
  const readyPromise = new Promise<ServerReady>((resolve, reject) => {
    const cleanup = () => {
      rl.off("line", onLine);
      child.off("exit", onExit);
    };
    const onLine = (line: string) => {
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
    rl.on("line", onLine);
    child.once("exit", onExit);
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

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[bob-daemon] ${chunk.toString("utf8")}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[bob-daemon] ${chunk.toString("utf8")}`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0) {
      console.warn(
        `[desktop] bob daemon exited (code=${code}, signal=${signal})`,
      );
    }
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
