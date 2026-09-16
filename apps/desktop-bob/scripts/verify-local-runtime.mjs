#!/usr/bin/env node
/** Real portable HTTP/auth/PGlite acceptance. Never uses an existing installation. */
import assert from "node:assert/strict";
import { createBobQueryClient } from "@gmacko/bob-client/query";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

const resources = process.env.BOB_PACKAGING_DIR;
assert(resources, "Set BOB_PACKAGING_DIR to the staged portable resources");
const baseDir = await mkdtemp(
  path.join(process.env.BOB_ACCEPTANCE_TMP_DIR ?? os.tmpdir(), "bob-runtime-"),
);
let child;
let logs = "";
async function stop() {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Server failed to stop")),
        12000,
      ).unref(),
    ),
  ]);
}
async function launch() {
  logs = "";
  const token = randomBytes(32).toString("hex");
  child = spawn(
    process.execPath,
    [
      path.join(resources, "bob-server/dist/bin.js"),
      "--base-dir",
      baseDir,
      "--port",
      "0",
      "--host",
      "127.0.0.1",
      "--bootstrap-fd",
      "3",
      "--no-browser",
    ],
    {
      cwd: resources,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BOB_BLDER_DIR: path.join(resources, "blder"),
        BOB_DB_MIGRATIONS_DIR: path.join(resources, "db-migrations"),
      },
    },
  );
  child.stdio[3].end(JSON.stringify({ authToken: token }));
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Readiness timed out: ${logs}`)),
      Number(process.env.BOB_SERVER_STARTUP_TIMEOUT_MS ?? 30000) + 15000,
    );
    child.stderr.on("data", (data) => {
      logs += data;
    });
    let output = "";
    child.stdout.on("data", (data) => {
      logs += data;
      output += data;
      for (const line of output.split("\n")) {
        try {
          const value = JSON.parse(line);
          if (value.url) {
            clearTimeout(timeout);
            resolve(value);
            return;
          }
        } catch {}
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${logs}`));
    });
  });
  assert.equal((await fetch(ready.url)).status, 401);
  const response = await fetch(`${ready.url}/?t=${token}`, {
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  const proxyCookie = response.headers.getSetCookie()[0].split(";")[0];
  return { url: ready.url, proxyCookie };
}
function account(server) {
  const cookies = new Map([
    [server.proxyCookie.split("=")[0], server.proxyCookie],
  ]);
  const request = async (route, body) => {
    const response = await fetch(server.url + route, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        cookie: [...cookies.values()].join("; "),
        origin: server.url,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      assert(!/domain=\.blder\.bot/i.test(cookie));
      const pair = cookie.split(";")[0];
      cookies.set(pair.split("=")[0], pair);
    }
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
  request.rpc = createBobQueryClient({
    baseURL: server.url + "/api/rpc",
    headers: () => ({
      cookie: [...cookies.values()].join("; "),
      origin: server.url,
    }),
  });
  return request;
}
try {
  let server = await launch();
  let alice = account(server),
    bob = account(server);
  assert.equal((await alice("/api/auth/get-session")).data, null);
  const password = randomBytes(18).toString("hex");
  assert.equal(
    (
      await alice("/api/auth/sign-up/email", {
        email: "alice@desktop.test",
        name: "Alice",
        password,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await bob("/api/auth/sign-up/email", {
        email: "bob@desktop.test",
        name: "Bob",
        password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await alice("/api/auth/get-session")).data.user.email,
    "alice@desktop.test",
  );
  const settings = await alice("/settings");
  assert.equal(settings.status, 200);
  const asset =
    /<script[^>]+src="([^"]+)"/.exec(settings.data)?.[1] ??
    /<link rel="modulepreload" href="([^"]+)"/.exec(settings.data)?.[1];
  assert(
    asset,
    `Authenticated HTML must reference an actual client script: ${String(settings.data).slice(0, 1200)}`,
  );
  assert.equal((await alice(asset)).status, 200);
  console.log("Checking Bob API-key authentication");
  const apiKey = await alice
    .rpc("settings.createApiKey")
    .call({ name: "Acceptance", permissions: ["read", "write"] });
  const keyedRpc = createBobQueryClient({
    baseURL: server.url + "/api/rpc",
    headers: {
      cookie: server.proxyCookie,
      authorization: "Bearer " + apiKey.key,
    },
  });
  assert.equal(
    (await keyedRpc("agent.session.getGatewayWebSocketUrl").call(undefined))
      .userId,
    (await alice.rpc("agent.session.getGatewayWebSocketUrl").call(undefined))
      .userId,
  );
  const foreignTenantRpc = createBobQueryClient({
    baseURL: server.url + "/api/rpc",
    headers: {
      cookie: server.proxyCookie,
      authorization: "Bearer " + apiKey.key,
      "x-tenant-id": "00000000-0000-4000-8000-000000000001",
    },
  });
  await assert.rejects(
    foreignTenantRpc("agent.session.getGatewayWebSocketUrl").call(undefined),
    (error) => error._tag === "UnauthorizedError",
  );
  await alice.rpc("settings.revokeApiKey").call({ id: apiKey.id });
  await assert.rejects(
    keyedRpc("agent.session.getGatewayWebSocketUrl").call(undefined),
    (error) => error._tag === "UnauthorizedError",
  );
  const workspace = await alice
    .rpc("projects.workspace.create")
    .call({ name: "Acceptance", slug: "acceptance" });
  assert(workspace.id);
  const project = await alice
    .rpc("project.create")
    .call({ workspaceId: workspace.id, name: "Acceptance", key: "ACC" });
  const work = await alice
    .rpc("planning.createTask")
    .call({
      projectId: project.id,
      title: "Verify the Effect workflow",
      kind: "task",
    });
  const workItemId = work.workItemId ?? work.id;
  assert(workItemId);
  const detail = await alice.rpc("workItem.get").call({ id: workItemId });
  assert.equal(detail.workItem.title, "Verify the Effect workflow");
  // This verifies dispatch persistence and result ingestion, not a live model invocation.
  console.log("Checking dispatch");
  const dispatched = await alice
    .rpc("workItem.dispatch")
    .call({ workItemId, agentType: "codex" });
  console.log("Checking load dispatched session");
  const runSession = await alice
    .rpc("agent.session.get")
    .call({ id: dispatched.sessionId });
  assert.equal(runSession.workItemId, workItemId);
  console.log("Checking load task runs");
  const runs = await alice
    .rpc("workItem.taskRun.listByWorkItem")
    .call({ workItemId });
  assert(runs.some((run) => run.sessionId === dispatched.sessionId));
  console.log("Checking report workflow progress");
  await alice
    .rpc("agent.session.reportWorkflowStatus")
    .call({
      sessionId: dispatched.sessionId,
      status: "working",
      message: "Acceptance fixture started",
    });
  console.log("Checking attach review fixture");
  await alice
    .rpc("agent.session.linkTaskArtifact")
    .call({
      sessionId: dispatched.sessionId,
      artifactType: "doc",
      artifactRole: "deliverable",
      url: "https://example.invalid/acceptance-result",
      title: "Acceptance result fixture",
    });
  console.log("Checking render review");
  const review = await alice(`/work-items/${workItemId}/review`);
  assert.equal(review.status, 200, "Execution review page should render");
  assert.match(String(review.data), /Acceptance result fixture/);
  console.log("Checking render detail");
  const workPage = await alice(`/work-items/${workItemId}`);
  assert.equal(workPage.status, 200, "Work detail should render");
  console.log("Checking gateway credential");
  const gateway = await alice
    .rpc("agent.session.getGatewayWebSocketUrl")
    .call(undefined);
  assert.equal(typeof gateway.token, "string");
  assert(
    gateway.token.length > 0,
    "Authenticated gateway credential must be present",
  );
  console.log("Checking create standalone session");
  const created = await alice
    .rpc("agent.session.create")
    .call({ workingDirectory: baseDir, title: "Portable Effect acceptance" });
  const id = created.id;
  assert.equal((await alice.rpc("agent.session.get").call({ id })).id, id);
  await assert.rejects(
    bob.rpc("agent.session.get").call({ id }),
    (error) => error._tag === "NotFoundError",
  );
  assert.equal(
    (await alice.rpc("agent.session.list").call({ limit: 100 })).items.length,
    2,
  );
  console.log("Checking restart");
  await stop();
  server = await launch();
  alice = account(server);
  assert.equal(
    (
      await alice("/api/auth/sign-in/email", {
        email: "alice@desktop.test",
        password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await alice.rpc("agent.session.getGatewayWebSocketUrl").call(undefined))
      .userId,
    gateway.userId,
  );
  const persisted = await alice.rpc("agent.session.list").call({ limit: 100 });
  assert.equal(persisted.items.length, 2);
  assert(
    persisted.items.some((session) => session.id === dispatched.sessionId),
  );
  assert.equal((await alice.rpc("agent.session.get").call({ id })).id, id);
  console.log(
    "PASS portable create-work, dispatch tracking, fixture-result review, Effect RPC, signed-cookie gateway credentials, PGlite migrations, local signup/login, settings, session persistence across restart, and cross-account denial",
  );
} finally {
  await stop();
  await rm(baseDir, { recursive: true, force: true });
}
