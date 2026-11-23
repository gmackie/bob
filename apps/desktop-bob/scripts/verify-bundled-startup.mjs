#!/usr/bin/env node
/** Run against final packaged resources and their bundled executable, never PATH. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";

const resources = path.resolve(process.argv[2] ?? "");
const executable = process.argv[3];
assert(executable && path.isAbsolute(executable), "Usage: node scripts/verify-bundled-startup.mjs <resources> <absolute bundled executable>");
const { verifyBundledResources, bundledServerEnvironment } = await import(pathToFileURL(path.join(resources, "bob-server/dist/bundled-resources.js")).href);
verifyBundledResources(resources);
const baseDir = await mkdtemp(path.join(os.tmpdir(), "Bob clean startup "));
let child;
let logs = "";
try {
  child = spawn(executable, [path.join(resources, "bob-server/dist/bin.js"), "--base-dir", baseDir, "--port", "0", "--host", "127.0.0.1", "--bootstrap-fd", "3", "--no-browser"], {
    cwd: resources,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    env: bundledServerEnvironment(resources, executable, { PATH: "", HOME: baseDir, TMPDIR: os.tmpdir(), BOB_SERVER_STARTUP_TIMEOUT_MS: "120000" }),
  });
  child.stdio[3].on("error", () => {});
  child.stdio[3].end(JSON.stringify({ authToken: "packaging-validation-only" }));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Startup timed out: ${logs}`)), 135000);
    let output = "";
    function finish(error, value) { clearTimeout(timer); if (error) reject(error); else resolve(value); }
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Bundled services exited ${code}: ${logs}`)));
    child.stderr.on("data", (data) => { logs += data; });
    child.stdout.on("data", (data) => {
      output += data;
      const lines = output.split("\n"); output = lines.pop();
      for (const line of lines) {
        logs += line + "\n";
        try { const value = JSON.parse(line); if (value.ready === true && value.url) finish(undefined, value); } catch {}
      }
    });
  });
  assert.equal((await fetch(ready.url)).status, 401);
  const bootstrap = await fetch(`${ready.url}/?t=packaging-validation-only`, { redirect: "manual" });
  assert.equal(bootstrap.status, 303);
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${ready.url}/api/auth/get-session`, { headers: { cookie } });
  assert.equal(response.status, 200, `Bundled app/auth/database failed: ${await response.text()}\n${logs}`);
  console.log(JSON.stringify({ passed: true, resources, executable, path: "", freshUserData: true, checks: ["resource checksums", "bundled runtime launch", "proxy auth", "application auth/database endpoint"] }, null, 2));
} finally {
  if (child?.pid && child.exitCode === null) {
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("Bundled services failed to stop")), 12000).unref())]);
  }
  await rm(baseDir, { recursive: true, force: true });
}
