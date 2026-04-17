import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
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

let serverChild: ChildProcess | null = null;
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

app.whenReady().then(async () => {
  const { url, token } = await spawnBobServer();

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
});
