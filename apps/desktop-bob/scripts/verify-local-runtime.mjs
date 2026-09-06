#!/usr/bin/env node
/** Real portable HTTP/auth/PGlite acceptance. Never uses an existing installation. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

const resources = process.env.BOB_PACKAGING_DIR;
assert(resources, "Set BOB_PACKAGING_DIR to the staged portable resources");
const baseDir = await mkdtemp(path.join(process.env.BOB_ACCEPTANCE_TMP_DIR ?? os.tmpdir(), "bob-runtime-"));
let child;
let logs = "";
async function stop() {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("Server failed to stop")), 12000).unref())]);
}
async function launch() {
  logs = "";
  const token = randomBytes(32).toString("hex");
  child = spawn(process.execPath, [path.join(resources, "bob-server/dist/bin.js"), "--base-dir", baseDir, "--port", "0", "--host", "127.0.0.1", "--bootstrap-fd", "3", "--no-browser"], {
    cwd: resources, stdio: ["ignore", "pipe", "pipe", "pipe"],
    env: { ...process.env, BOB_BLDER_DIR: path.join(resources, "blder"), BOB_DB_MIGRATIONS_DIR: path.join(resources, "db-migrations") },
  });
  child.stdio[3].end(JSON.stringify({ authToken: token }));
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Readiness timed out: ${logs}`)), Number(process.env.BOB_SERVER_STARTUP_TIMEOUT_MS ?? 30000) + 15000);
    child.stderr.on("data", data => { logs += data; });
    let output = "";
    child.stdout.on("data", data => {
      logs += data; output += data;
      for (const line of output.split("\n")) {
        try { const value = JSON.parse(line); if (value.url) { clearTimeout(timeout); resolve(value); return; } } catch {}
      }
    });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
  });
  assert.equal((await fetch(ready.url)).status, 401);
  const response = await fetch(`${ready.url}/?t=${token}`, { redirect: "manual" });
  assert.equal(response.status, 303);
  const proxyCookie = response.headers.getSetCookie()[0].split(";")[0];
  return { url: ready.url, proxyCookie };
}
function account(server) {
  const cookies = new Map([[server.proxyCookie.split("=")[0], server.proxyCookie]]);
  return async (route, body) => {
    const response = await fetch(server.url + route, { method: body === undefined ? "GET" : "POST", redirect: "manual",
      headers: { cookie: [...cookies.values()].join("; "), origin: server.url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
      assert(!/domain=\.blder\.bot/i.test(cookie));
      const pair = cookie.split(";")[0]; cookies.set(pair.split("=")[0], pair);
    }
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
}
try {
  let server = await launch();
  let alice = account(server), bob = account(server);
  assert.equal((await alice("/api/auth/get-session")).data, null);
  const password = randomBytes(18).toString("hex");
  assert.equal((await alice("/api/auth/sign-up/email", { email: "alice@desktop.test", name: "Alice", password })).status, 200);
  assert.equal((await bob("/api/auth/sign-up/email", { email: "bob@desktop.test", name: "Bob", password })).status, 200);
  assert.equal((await alice("/api/auth/get-session")).data.user.email, "alice@desktop.test");
  const settings = await alice("/settings");
  assert.equal(settings.status, 200);
  const asset = /<script[^>]+src="([^"]+)"/.exec(settings.data)?.[1] ?? /<link rel="modulepreload" href="([^"]+)"/.exec(settings.data)?.[1];
  assert(asset, `Authenticated HTML must reference an actual client script: ${String(settings.data).slice(0, 1200)}`);
  assert.equal((await alice(asset)).status, 200);
  const created = await alice("/api/trpc/session.create", { json: { workingDirectory: baseDir, title: "Portable acceptance" } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.result.data.json.id;
  const route = "/api/trpc/session.get?input=" + encodeURIComponent(JSON.stringify({ json: { id } }));
  assert.equal((await bob(route)).status, 404);
  await stop();
  server = await launch(); alice = account(server);
  assert.equal((await alice("/api/auth/sign-in/email", { email: "alice@desktop.test", password })).status, 200);
  assert.equal((await alice(route)).data.result.data.json.id, id);
  console.log("PASS portable PGlite migrations, local signup/login, settings, session persistence across restart, and cross-account denial");
} finally { await stop(); await rm(baseDir, { recursive: true, force: true }); }
