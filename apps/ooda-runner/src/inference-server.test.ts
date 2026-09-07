import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionExecutor } from "./session/session-executor";
import type { AgentAdapter } from "@gmacko/ooda/agent-adapters";
import { request } from "node:http";
import { once } from "node:events";
import { startInferenceServer } from "./inference-server";
import { RunnerConfigSchema } from "./config";
import type { RunnerServer } from "./runner-server";
const servers: ReturnType<typeof startInferenceServer>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const runner = {
  listAdapterIds: () => [],
  getAdapter: () => undefined,
} as unknown as RunnerServer;
async function start(target = runner) {
  const server = startInferenceServer(
    target,
    RunnerConfigSchema.parse({ port: 0 }),
  );
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No address");
  return `http://127.0.0.1:${address.port}`;
}
it("refuses inference when the server key is not configured", async () => {
  vi.stubEnv("BOB_API_KEY", "");
  const base = await start();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({
      model: "claude/test",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("authentication is not configured");
});

it("rejects an unauthorized client before it finishes uploading its body", async () => {
  vi.stubEnv("BOB_API_KEY", "test-key");
  const base = await start();
  const response = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${base}/v1/chat/completions`,
      { method: "POST", headers: { "Content-Length": "9999999" } },
      (res) => {
        resolve(res.statusCode);
        res.resume();
        req.destroy();
      },
    );
    req.on("error", reject);
    req.setTimeout(1000, () => {
      req.destroy();
      reject(Error("waited for unauthenticated body"));
    });
    req.flushHeaders();
  });
  expect(response).toBe(401);
});

it("bounds an authenticated JSON body before provider execution", async () => {
  vi.stubEnv("BOB_API_KEY", "test-key");
  const base = await start();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer test-key" },
    body: JSON.stringify({
      model: "claude/test",
      messages: [{ role: "user", content: "x".repeat(1024 * 1024 + 1) }],
    }),
  });
  expect(response.status).toBe(413);
});

it("executes authenticated inference with the requested model through the real session executor", async () => {
  vi.stubEnv("BOB_API_KEY", "test-key");
  const storageRoot = mkdtempSync(join(tmpdir(), "inference-model-"));
  mkdirSync(join(storageRoot, "inference-gateway"));
  const adapter: AgentAdapter = {
    id: "claude",
    name: "test",
    transport: "stdio",
    isAvailable: () => true,
    buildCommand: (options) => ({
      binary: "test",
      args: [options.model ?? "missing-model"],
      cwd: options.workspaceRoot,
    }),
    execute: async (command, onEvent) => {
      onEvent({
        type: "stdout",
        data: command.args[0]!,
        timestamp: new Date().toISOString(),
      });
      return { exitCode: 0 };
    },
  };
  try {
    const target = {
      listAdapterIds: () => ["claude"],
      getAdapter: () => adapter,
      createExecutor: () => new SessionExecutor({ adapter, storageRoot }),
    } as unknown as RunnerServer;
    const base = await start(target);
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body: JSON.stringify({
        model: "claude/explicit-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.choices[0].message.content).toBe("explicit-model");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

it("cancels adapter execution when the HTTP client disconnects", async () => {
  vi.stubEnv("BOB_API_KEY", "test-key");
  const storageRoot = mkdtempSync(join(tmpdir(), "inference-abort-"));
  mkdirSync(join(storageRoot, "inference-gateway"));
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  let didAbort!: () => void;
  const aborted = new Promise<void>((resolve) => {
    didAbort = resolve;
  });
  const adapter: AgentAdapter = {
    id: "claude",
    name: "test",
    transport: "stdio",
    isAvailable: () => true,
    buildCommand: (options) => ({
      binary: "test",
      args: [],
      cwd: options.workspaceRoot,
    }),
    execute: async (_command, _event, options) => {
      started();
      return await new Promise((resolve) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            didAbort();
            resolve({ exitCode: 1 });
          },
          { once: true },
        );
      });
    },
  };
  try {
    const base = await start({
      listAdapterIds: () => ["claude"],
      getAdapter: () => adapter,
      createExecutor: () => new SessionExecutor({ adapter, storageRoot }),
    } as unknown as RunnerServer);
    const controller = new AbortController();
    const response = fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: "Bearer test-key" },
      body: JSON.stringify({
        model: "claude/test",
        messages: [{ role: "user", content: "hello" }],
      }),
    }).catch(() => undefined);
    await running;
    controller.abort();
    await response;
    await Promise.race([
      aborted,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("execution was not cancelled")), 1000),
      ),
    ]);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
