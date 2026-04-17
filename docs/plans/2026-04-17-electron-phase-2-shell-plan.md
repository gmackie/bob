# Electron Phase 2 — Shell + bob-server Wrapper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Launch Bob as a native macOS app window. `pnpm --filter @bob/desktop dev` spawns an Electron window that auto-spawns a local Node server (bob-server) + the Go `bob` daemon, and renders the full blder UI end-to-end with PGlite persistence.

**Architecture:** Introduce `apps/bob-server` (Node HTTP server wrapping `apps/blder`'s vinext output with CLI flags + auth-token). Introduce `apps/desktop` (Electron shell mirroring `/Volumes/dev/t3code/apps/desktop`'s layout, adapted for Bob). Bundle the existing Go daemon binary under `apps/desktop/resources/bin/`. No `packages/desktop-server-core` yet — we fold that plumbing into `apps/bob-server` as internal modules; extract when a second consumer (ooda) appears.

**Tech Stack:** electron 40.x, electron-updater, Node's native `http` module (same pattern as `apps/ws-gateway`), tsdown for bundling desktop main/preload, commander (or yargs) for bob-server CLI.

**Depends on:** Phase 1 shipped (`docs/plans/2026-04-17-electron-phase-1-node-server-plan.md`). PGlite works, `BOB_DB_DRIVER=pglite` wires up correctly, blder builds for Node target.

**Reference:** `/Volumes/dev/t3code/apps/desktop/src/main.ts` (1476 lines) and `/Volumes/dev/t3code/apps/server/src/{bin,cli,http,server,bootstrap}.ts` — we mirror structure, not literal code.

**Scope:**
- `apps/bob-server` with CLI flags, auth-token middleware, bootstrap-fd envelope, vinext child process management
- `apps/desktop` Electron shell: main, preload, window lifecycle, subprocess spawning, log sinks
- Bundled Go `bob` daemon spawn with dynamic URL+token
- Dev + build scripts for both apps

**Out of scope (later phases):**
- Connection manager UI / multi-server switching (Phase 3)
- GitHub OAuth for cloud.bob.io (Phase 3)
- electron-builder DMG, signing, notarization (Phase 4)
- Auto-updater wiring (Phase 4)
- Windows/Linux builds (not planned)

---

## Prerequisites

1. Phase 1 done-criteria all checked
2. `pnpm turbo typecheck` clean on `main`
3. macOS 13+ with Xcode command-line tools (for code sign chain later; not required to run dev)
4. Go `bob` binary built locally: `cd ~/dev/bob-cli && GOOS=darwin GOARCH=arm64 go build -o bob-darwin-arm64 ./cmd/bob && GOOS=darwin GOARCH=amd64 go build -o bob-darwin-amd64 ./cmd/bob` — copy these into `apps/desktop/resources/bin/` when Task 10 runs

---

## Task 1: Scaffold `apps/bob-server` package

**Files:**
- Create: `apps/bob-server/package.json`
- Create: `apps/bob-server/tsconfig.json`
- Create: `apps/bob-server/src/bin.ts`
- Create: `apps/bob-server/README.md` (one paragraph; no marketing prose)

**Step 1: package.json**

```json
{
  "name": "@bob/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": {
    "bob-server": "./dist/bin.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "start": "node dist/bin.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@bob/blder": "workspace:*",
    "@bob/db": "workspace:*",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Step 2: tsconfig.json**

Extend whichever base config the other apps use (check `tooling/tsconfig/base.json` or similar).

**Step 3: bin.ts stub**

```typescript
#!/usr/bin/env node
import { main } from "./cli.js";
main(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 4: Install + verify workspace picks it up**

Run: `pnpm install`
Run: `pnpm --filter @bob/server typecheck`
Expected: fails with "cli.js not found" — expected until Task 2.

**Step 5: Commit**

```bash
git add apps/bob-server
git commit -m "feat(server): scaffold @bob/server package"
```

---

## Task 2: Write failing test for CLI flag parsing

**Files:**
- Create: `apps/bob-server/src/cli.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("parses defaults", () => {
    const args = parseArgs(["node", "bob-server"]);
    expect(args).toMatchObject({
      port: 0, // 0 means pick a free port
      host: "127.0.0.1",
      authToken: undefined,
      bootstrapFd: undefined,
      noBrowser: false,
      baseDir: expect.stringContaining(".bob"),
    });
  });

  it("parses explicit flags", () => {
    const args = parseArgs([
      "node", "bob-server",
      "--port", "3773",
      "--host", "0.0.0.0",
      "--auth-token", "abc123",
      "--base-dir", "/tmp/bob-test",
      "--no-browser",
    ]);
    expect(args).toMatchObject({
      port: 3773,
      host: "0.0.0.0",
      authToken: "abc123",
      baseDir: "/tmp/bob-test",
      noBrowser: true,
    });
  });

  it("reads BOOTSTRAP_FD as integer", () => {
    const args = parseArgs(["node", "bob-server", "--bootstrap-fd", "3"]);
    expect(args.bootstrapFd).toBe(3);
  });
});
```

Run: `pnpm --filter @bob/server test`
Expected: FAIL (cli.ts missing).

---

## Task 3: Implement CLI flag parsing

**Files:**
- Create: `apps/bob-server/src/cli.ts`

```typescript
import path from "node:path";
import os from "node:os";
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
    .option("--port <number>", "HTTP port (0 = random free)", (v) => parseInt(v, 10), 0)
    .option("--host <address>", "Bind address", "127.0.0.1")
    .option("--auth-token <token>", "Bearer token required for all requests")
    .option("--bootstrap-fd <fd>", "Read auth-token JSON envelope from inherited FD", (v) => parseInt(v, 10))
    .option("--base-dir <path>", "Persistence dir", path.join(os.homedir(), ".bob"))
    .option("--no-browser", "Do not auto-open browser on start")
    .allowExcessArguments(false);

  program.parse(argv);
  const opts = program.opts();

  return {
    port: opts.port,
    host: opts.host,
    authToken: opts.authToken,
    bootstrapFd: opts.bootstrapFd,
    noBrowser: !opts.browser, // commander inverts --no-browser into opts.browser=false
    baseDir: opts.baseDir,
  };
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  // Full startup flow added in Task 6.
  console.log("parsed", args);
}
```

Run: `pnpm --filter @bob/server test`
Expected: PASS.

Commit: `feat(server): CLI flag parsing`

---

## Task 4: Bootstrap-fd envelope handling (test first)

**Files:**
- Create: `apps/bob-server/src/bootstrap.test.ts`
- Create: `apps/bob-server/src/bootstrap.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { readBootstrapEnvelope } from "./bootstrap.js";

describe("readBootstrapEnvelope", () => {
  it("reads a JSON envelope from a file descriptor", async () => {
    // Create a pipe, write envelope to write end, pass read fd.
    const { createReadStream } = await import("node:fs");
    const { Readable } = await import("node:stream");
    const envelope = JSON.stringify({ authToken: "from-fd" });
    const stream = Readable.from([Buffer.from(envelope)]);
    const result = await readBootstrapEnvelope(stream);
    expect(result).toEqual({ authToken: "from-fd" });
  });
});
```

**Step 2: Implementation**

```typescript
import { Readable } from "node:stream";

export type BootstrapEnvelope = {
  authToken?: string;
};

export async function readBootstrapEnvelope(stream: Readable): Promise<BootstrapEnvelope> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed == null) throw new Error("bootstrap envelope not an object");
  return parsed;
}

export function openFdStream(fd: number): Readable {
  // node:fs does not expose a direct fd→Readable helper; use net.Socket on a pipe fd.
  const { Socket } = require("node:net");
  return new Socket({ fd, readable: true, writable: false });
}
```

Run: `pnpm --filter @bob/server test -- bootstrap`
Expected: PASS.

Commit: `feat(server): bootstrap-fd envelope reader`

---

## Task 5: HTTP server factory with auth-token middleware (test first)

**Files:**
- Create: `apps/bob-server/src/http.test.ts`
- Create: `apps/bob-server/src/http.ts`

**Step 1: Failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createHttpServer } from "./http.js";

describe("createHttpServer auth-token middleware", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createHttpServer({
      authToken: "secret",
      handler: async (_req, res) => {
        res.statusCode = 200;
        res.end("ok");
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejects requests without a token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(401);
  });

  it("accepts requests with Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts requests with ?t= query parameter (browser bootstrap)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/?t=secret`);
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Implementation**

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type HttpServerOptions = {
  authToken: string | undefined;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

export function createHttpServer(opts: HttpServerOptions) {
  return createServer(async (req, res) => {
    if (opts.authToken) {
      const header = req.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
      const query = url.searchParams.get("t") ?? undefined;
      if (bearer !== opts.authToken && query !== opts.authToken) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
    }
    try {
      await opts.handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("internal");
      }
    }
  });
}
```

Run: `pnpm --filter @bob/server test -- http`
Expected: PASS.

Commit: `feat(server): auth-token middleware on http factory`

---

## Task 6: Wire full startup: spawn vinext, reverse-proxy, auth gate

**Files:**
- Create: `apps/bob-server/src/server.ts`
- Modify: `apps/bob-server/src/cli.ts` (main() calls startServer)

**Context:** `apps/blder`'s vinext `start` already produces a working HTTP server when invoked with `BOB_BUILD_TARGET=node`. Phase 1 proved that. The simplest path: bob-server spawns vinext as a child on an internal port, then reverse-proxies all requests through the auth-gated front door.

**Step 1: server.ts**

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpServer } from "./http.js";
import type { CliArgs } from "./cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// blder app lives two up from dist/ → apps/bob-server/dist → apps/bob-server → apps → apps/blder
const BLDER_DIR = path.resolve(__dirname, "../../blder");

export async function startServer(args: CliArgs & { authToken: string }): Promise<{ url: string; stop: () => Promise<void> }> {
  // Pick an internal port for vinext's child process — always random and always localhost.
  const internalPort = await findFreePort();

  const child: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@bob/blder", "start"],
    {
      cwd: BLDER_DIR,
      env: {
        ...process.env,
        PORT: String(internalPort),
        HOST: "127.0.0.1",
        BOB_DB_DRIVER: "pglite",
        BOB_DB_PGLITE_DIR: path.join(args.baseDir, "userdata", "db"),
        BOB_BUILD_TARGET: "node",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  // Wait for vinext to respond on internalPort before accepting external traffic.
  await waitForPort("127.0.0.1", internalPort, 30_000);

  const server = createHttpServer({
    authToken: args.authToken,
    handler: async (req, res) => {
      await proxyToInternal(req, res, internalPort);
    },
  });

  await new Promise<void>((r) => server.listen(args.port, args.host, r));
  const address = server.address() as { port: number };
  const url = `http://${args.host}:${address.port}`;

  const stop = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    child.kill("SIGTERM");
  };

  return { url, stop };
}

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/`, { method: "HEAD" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vinext did not come up on ${host}:${port} within ${timeoutMs}ms`);
}

async function proxyToInternal(req: any, res: any, port: number) {
  const http = await import("node:http");
  const target = http.request(
    {
      hostname: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 500, upstream.headers);
      upstream.pipe(res);
    },
  );
  req.pipe(target);
  target.on("error", (err) => {
    console.error("proxy error", err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("bad gateway");
    }
  });
}
```

**Step 2: Update cli.ts `main`**

```typescript
import crypto from "node:crypto";
import { startServer } from "./server.js";
import { openFdStream, readBootstrapEnvelope } from "./bootstrap.js";

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  let authToken = args.authToken;
  if (args.bootstrapFd !== undefined) {
    const envelope = await readBootstrapEnvelope(openFdStream(args.bootstrapFd));
    authToken = envelope.authToken ?? authToken;
  }
  if (!authToken && args.host !== "127.0.0.1") {
    throw new Error("--auth-token (or --bootstrap-fd) is required when --host is not 127.0.0.1");
  }
  authToken = authToken ?? crypto.randomBytes(32).toString("hex");

  const { url } = await startServer({ ...args, authToken });

  console.log(JSON.stringify({ ready: true, url, authToken }));

  if (!args.noBrowser) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    const { spawn } = await import("node:child_process");
    spawn(opener, [`${url}/?t=${authToken}`], { detached: true, stdio: "ignore" }).unref();
  }
}
```

**Step 3: Add integration test (headless smoke)**

This test is too heavyweight for CI — mark it `.skip()` by default but keep it in-tree for manual runs:

```typescript
// apps/bob-server/src/server.integration.test.ts
import { describe, expect, it } from "vitest";
import { startServer } from "./server.js";

describe.skip("bob-server integration (manual only)", () => {
  it("boots vinext + proxies auth-gated traffic", async () => {
    const { url, stop } = await startServer({
      port: 0, host: "127.0.0.1", authToken: "t",
      bootstrapFd: undefined, noBrowser: true,
      baseDir: "/tmp/bob-integration",
    });
    try {
      const res = await fetch(`${url}/?t=t`);
      expect(res.status).toBeLessThan(500);
    } finally {
      await stop();
    }
  }, 60_000);
});
```

**Step 4: Manual smoke**

```bash
pnpm --filter @bob/blder build
pnpm --filter @bob/server build
pnpm --filter @bob/server start --port 3773 --no-browser
# In another terminal:
curl -v http://127.0.0.1:3773/                    # → 401
curl -v -H "Authorization: Bearer <token from stdout>" http://127.0.0.1:3773/   # → 200, html
```

Expected: unauthorized without token, HTML renders with token.

Commit: `feat(server): proxy-mode server with auth gate and vinext child`

---

## Task 7: Scaffold `apps/desktop` Electron package

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsdown.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main.ts` (stub)
- Create: `apps/desktop/src/preload.ts` (stub)

**Step 1: package.json**

```json
{
  "name": "@bob/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "dist-electron/main.js",
  "productName": "Bob",
  "scripts": {
    "dev": "pnpm run --parallel dev:bundle dev:electron",
    "dev:bundle": "tsdown --watch",
    "dev:electron": "node scripts/dev-electron.mjs",
    "build": "tsdown",
    "start": "node scripts/start-electron.mjs",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "electron": "40.6.0"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

**Step 2: tsdown.config.ts**

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  outDir: "dist-electron",
  format: ["cjs"],
  target: "node22",
  platform: "node",
  external: ["electron"],
  dts: false,
});
```

**Step 3: Stub main.ts**

```typescript
import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800 });
  win.loadURL("about:blank");
});
```

**Step 4: Typecheck**

Run: `pnpm --filter @bob/desktop typecheck`
Expected: clean.

Commit: `feat(desktop): scaffold Electron app`

---

## Task 8: Desktop helper scripts

**Files:**
- Create: `apps/desktop/scripts/dev-electron.mjs`
- Create: `apps/desktop/scripts/start-electron.mjs`

**dev-electron.mjs:**

Waits for `dist-electron/main.js` to exist, then launches electron with a dev flag.

```javascript
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const main = path.resolve("dist-electron/main.js");
while (!fs.existsSync(main)) await new Promise((r) => setTimeout(r, 200));

const electron = require("electron");
const proc = spawn(electron, [main], {
  stdio: "inherit",
  env: { ...process.env, BOB_DESKTOP_DEV: "1" },
});
proc.on("exit", (code) => process.exit(code ?? 0));
```

**start-electron.mjs:**

```javascript
import { spawn } from "node:child_process";
import path from "node:path";

const electron = require("electron");
const proc = spawn(electron, [path.resolve("dist-electron/main.js")], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code ?? 0));
```

Commit: `feat(desktop): dev + start scripts`

---

## Task 9: Main.ts spawns bob-server + loads BrowserWindow

**Files:**
- Modify: `apps/desktop/src/main.ts`

**Context:** Electron main:
1. Generates an auth token
2. Spawns bob-server as a subprocess, passing token via env (bootstrap-fd migration deferred — env is adequate since bob-server is a child, not user-launched)
3. Parses `ready` line from bob-server stdout to learn the server URL
4. Creates BrowserWindow pointing at `{url}/?t={token}`
5. On app quit, SIGTERMs bob-server

```typescript
import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline";

const APP_ROOT = path.resolve(__dirname, "../..");
const BOB_SERVER_BIN = path.join(APP_ROOT, "bob-server/dist/bin.js");

let serverChild: ChildProcess | null = null;
let win: BrowserWindow | null = null;

async function spawnBobServer(): Promise<{ url: string; token: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const child = spawn("node", [BOB_SERVER_BIN, "--port", "0", "--host", "127.0.0.1", "--auth-token", token, "--no-browser"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env },
  });
  serverChild = child;

  const rl = readline.createInterface({ input: child.stdout! });
  for await (const line of rl) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.ready && parsed.url) {
        return { url: parsed.url, token };
      }
    } catch {
      // non-JSON log, ignore
    }
  }
  throw new Error("bob-server exited before reporting ready");
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
```

Run: `pnpm --filter @bob/desktop build && pnpm --filter @bob/desktop start`
Expected: window opens, blder UI loads. If you see a white screen, check DevTools (`Cmd+Opt+I`) for console errors.

Commit: `feat(desktop): spawn bob-server + load window`

---

## Task 10: Bundle Go daemon binary + spawn eagerly

**Files:**
- Create: `apps/desktop/resources/bin/bob-darwin-arm64`
- Create: `apps/desktop/resources/bin/bob-darwin-amd64`
- Modify: `apps/desktop/src/main.ts`

**Step 1: Copy binaries**

```bash
mkdir -p apps/desktop/resources/bin
cp ~/dev/bob-cli/bob-darwin-arm64 apps/desktop/resources/bin/
cp ~/dev/bob-cli/bob-darwin-amd64 apps/desktop/resources/bin/
chmod +x apps/desktop/resources/bin/bob-darwin-*
```

**Step 2: Add to .gitignore rules or Git LFS as appropriate**

Binaries are large. If the repo uses LFS, configure:

```
# .gitattributes
apps/desktop/resources/bin/bob-darwin-* filter=lfs diff=lfs merge=lfs -text
```

Otherwise check if binaries under 100MB are fine to commit directly (they should be — `bob` is a small Go binary).

**Step 3: Spawn daemon in main.ts**

Add after `spawnBobServer()` completes:

```typescript
import os from "node:os";

let daemonChild: ChildProcess | null = null;

function spawnDaemon(serverUrl: string, token: string) {
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  const binPath = path.join(__dirname, "..", "resources", "bin", `bob-darwin-${arch}`);
  daemonChild = spawn(binPath, ["daemon", "start", "--server-url", serverUrl, "--auth-token", token], {
    stdio: "inherit",
    env: { ...process.env },
  });
}

// in app.whenReady, right after spawnBobServer:
spawnDaemon(url, token);

// in app.on("before-quit"):
daemonChild?.kill("SIGTERM");
```

**Step 4: Verify daemon connects**

After launching, watch daemon logs in terminal:
Expected: "heartbeat ok" or equivalent line confirming daemon reached the server.

Commit: `feat(desktop): bundle + spawn Go bob daemon`

---

## Task 11: Rotating log sink for main-process output

**Files:**
- Create: `apps/desktop/src/rotatingFileSink.ts`
- Create: `apps/desktop/src/rotatingFileSink.test.ts`
- Modify: `apps/desktop/src/main.ts` (pipe child stdout/stderr through sink)

Mirror t3code's `/Volumes/dev/t3code/apps/desktop/src/rotatingFileSink.ts`. Key behavior: writes to `~/.bob/userdata/logs/main.log`, rotates at 10MB, keeps 10 files.

Tests verify: new file on rotation, old file removed when count exceeds max.

Commit: `feat(desktop): rotating file log sink`

---

## Task 12: Graceful shutdown + zombie cleanup

**Files:**
- Modify: `apps/desktop/src/main.ts`

Add:
- `SIGINT`/`SIGTERM` handlers on the Electron process that kill children before exit
- Timeout: if `serverChild` / `daemonChild` doesn't exit within 3s of SIGTERM, send SIGKILL
- `process.on("exit")` as last-resort kill

Add test (optional — hard to test cleanly in vitest) OR do manual verification:

1. `pnpm --filter @bob/desktop start`
2. Find bob-server + bob daemon processes (`ps aux | grep bob`)
3. Quit Electron via Cmd+Q
4. Re-run `ps aux | grep bob` — should show no lingering processes

Commit: `feat(desktop): graceful child shutdown`

---

## Task 13: Dev mode hot-reload integration

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/scripts/dev-electron.mjs`

**Context:** In dev, we want `pnpm --filter @bob/desktop dev` to:
- Run tsdown --watch (rebuild main/preload on edit)
- Run Electron pointed at the built output
- Run vinext dev inside bob-server (already in place via Task 6 — vinext's own dev server)

For iteration speed: if `BOB_DESKTOP_DEV=1`, bob-server should spawn `pnpm --filter @bob/blder dev` (not `build && start`), so blder HMR works.

**Step 1: In bob-server's server.ts**

Change the spawn based on `BOB_DESKTOP_DEV`:

```typescript
const script = process.env.BOB_DESKTOP_DEV === "1" ? "dev" : "start";
const child = spawn("pnpm", ["--filter", "@bob/blder", script], { ... });
```

**Step 2: Verify Electron reloads main.ts on edit**

Use `electron-reload` or a simple watcher that re-launches Electron when dist-electron changes. Mirror t3code if they have one; otherwise skip — Cmd+Q + re-run dev is adequate for Phase 2.

Commit: `feat(desktop): dev-mode HMR via vinext dev`

---

## Task 14: Phase 2 end-to-end smoke

**Files:** (no edits)

**Step 1:** `pnpm --filter @bob/desktop dev`

**Expected:**
- Electron window opens within 10s
- blder UI renders
- Sign in or land on the default page (matching Phase 1 smoke)
- Go daemon logs heartbeat success
- Creating a workspace persists to `~/.bob/userdata/db/`

**Step 2:** Cmd+Q quits cleanly, no orphaned `bob-server` / `bob` processes

**Step 3:** Re-launch — data still there

**Step 4:** Commit an empty milestone marker

```bash
git commit --allow-empty -m "feat(desktop): Phase 2 end-to-end smoke passes"
```

---

## Done criteria

- [ ] `apps/bob-server` built, CLI flags tested, proxy mode works
- [ ] `apps/desktop` built, Electron window opens on `pnpm --filter @bob/desktop dev`
- [ ] Go daemon bundled, spawned eagerly, connects to bob-server
- [ ] Logs written to `~/.bob/userdata/logs/main.log` with rotation
- [ ] Clean shutdown verified (no zombie processes)
- [ ] Manual smoke: end-to-end UI works with PGlite persistence

Phase 2 ships when all boxes checked.

---

## Risks (revisit during execution)

1. **pnpm inside Electron's packaged app**: Task 6 spawns `pnpm --filter @bob/blder start` — that works in dev but breaks in a packaged DMG (no pnpm available). Phase 4 packaging must replace with a direct `node blder/server/entry.js` invocation. For Phase 2 (dev only) this is fine.
2. **Binary size**: Go daemon binaries + Electron + PGlite WASM may push the package size high. Monitor but don't optimize until Phase 4.
3. **macOS Gatekeeper in dev**: unsigned Electron dev launches trigger "cannot be opened" dialogs. Right-click → Open bypasses; not worth signing until Phase 4.
4. **Daemon CLI shape**: Task 10 assumes `bob daemon start --server-url ... --auth-token ...`. Verify the actual Go CLI supports this — if it takes different flag names, adapt the spawn args.
