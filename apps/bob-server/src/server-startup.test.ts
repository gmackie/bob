import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { serverStartupTimeout } from "./startup-timeout.js";
vi.mock("./process-tree.js", () => ({ terminateProcessTree: vi.fn(async (child) => {
  const exit = once(child, "exit");
  process.kill(-child.pid, "SIGKILL");
  await exit;
  throw new Error("cleanup evidence");
}) }));
import { startServer } from "./server.js";

it.skipIf(process.platform === "win32")("keeps both the original readiness failure and cleanup failure", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "bob-startup-"));
  const original = { ...process.env };
  try {
    const entry = path.join(baseDir, "upstream.mjs");
    await writeFile(entry, "setInterval(()=>{},1000);");
    process.env.BOB_BLDER_DIR = baseDir;
    process.env.BOB_VINEXT_CLI = entry;
    process.env.BOB_SERVER_STARTUP_TIMEOUT_MS = "1000";
    const error = await startServer({ baseDir, port: 0, host: "127.0.0.1", authToken: "fixture", noBrowser: true, bootstrapFd: undefined }).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0].message).toContain("blder did not come up");
    expect(error.errors[1].message).toBe("cleanup evidence");
  } finally { process.env = original; await rm(baseDir, { recursive: true, force: true }); }
});

it("uses the normal deadline unless explicitly configured within a finite bound", () => {
  expect(serverStartupTimeout({})).toBe(30000);
  expect(serverStartupTimeout({ BOB_SERVER_STARTUP_TIMEOUT_MS: "300000" })).toBe(300000);
  for (const value of ["0", "NaN", "Infinity", "300001"]) expect(() => serverStartupTimeout({ BOB_SERVER_STARTUP_TIMEOUT_MS: value })).toThrow();
});
