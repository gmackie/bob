import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @gmacko/emulate's postgres mock is backed by PGlite, which persists to
// disk at <cwd>/data/pglite. It does NOT create that directory itself
// (mkdirSync without `recursive: true` internally) -- on a fresh CI
// checkout this directory never exists, so the postgres component throws
// ENOENT and never starts, while the emulate CLI's own control port comes up
// fine. This looked like a slow/flaky startup (tests would hang until
// vitest's timeout) but was actually a permanent, immediate failure that no
// amount of waiting would fix. (Same issue documented in netcontrol's
// test/emulate-setup.ts -- carried forward here verbatim.)
const PGLITE_DATA_DIR = "data/pglite";

// This file lives at <repo-root>/test/emulate-setup.ts and is shared by
// every package's vitest.config.ts (packages/bob/src/db, packages/bob/src/api)
// via a relative globalSetup path, so ROOT always resolves to the actual
// monorepo root regardless of which package's vitest process loads it.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = resolve(ROOT, ".turbo/.emulate-lock");

let proc: ChildProcess | null = null;
let ownsLock = false;

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Port ${port} not ready after ${timeoutMs}ms`);
}

function tryAcquireLock(): boolean {
  mkdirSync(resolve(ROOT, ".turbo"), { recursive: true });
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    ownsLock = true;
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  if (ownsLock) {
    try {
      unlinkSync(LOCK);
    } catch {
      // already gone / never ours -- nothing to clean up.
    }
    ownsLock = false;
  }
}

// packages/bob/src/db and packages/bob/src/api both share this globalSetup
// and run concurrently via turbo (separate vitest OS processes). Only the
// process that wins tryAcquireLock() starts emulate and waits for postgres
// (5432) to be query-ready; every other path used to only wait for the
// control port (4000), which opens well before postgres/PGlite's wire
// protocol is actually ready -- letting a losing process's tests run before
// postgres was up. @bob/db's own test suite fires a real query immediately
// on import, so it's the one that would always catch the race as
// ECONNREFUSED. Every return path now waits for both ports.
async function waitForSharedInstance(): Promise<void> {
  await waitForPort(4000, 180_000);
  await waitForPort(5432, 180_000);
}

export async function setup() {
  if (await isPortOpen(4000)) {
    await waitForSharedInstance();
    return;
  }

  if (!tryAcquireLock()) {
    await waitForSharedInstance();
    return;
  }

  // bob only needs the postgres wire-protocol mock -- no github/stripe/etc.
  // provider mocks are exercised by @bob/db or @bob/api's test suites.
  const services = ["postgres"];
  mkdirSync(resolve(ROOT, PGLITE_DATA_DIR), { recursive: true });

  proc = spawn(
    "npx",
    [
      "@gmacko/emulate",
      "start",
      "-s",
      services.join(","),
      "--seed",
      "emulate.config.yaml",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT,
    },
  );

  proc.on("error", () => {});
  proc.on("exit", () => {
    proc = null;
  });

  try {
    // A cold npx cache means @gmacko/emulate has to install (and, per
    // netcontrol's notes, potentially compile bundled native deps) before
    // ANY of its output appears, including opening its own control port
    // (4000). Give both waits real headroom on a cold CI runner.
    await waitForPort(4000, 180_000);
    // Only the control port was awaited above. Postgres/PGlite can take
    // meaningfully longer to become query-ready than the control port --
    // wait for 5432 explicitly so globalSetup doesn't return "ready" before
    // the first real query would actually succeed.
    await waitForPort(5432, 180_000);
  } catch (err) {
    releaseLock();
    throw err;
  }
}

export async function teardown() {
  if (proc) {
    proc.kill("SIGTERM");
    proc = null;
  }
  releaseLock();
}
