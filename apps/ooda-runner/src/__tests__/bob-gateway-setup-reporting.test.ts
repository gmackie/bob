import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@gmacko/core/telemetry/deep", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  withTraceSpan: async (_name: string, fn: () => Promise<unknown>) => fn(),
  getTraceReference: () => ({ traceId: "1".repeat(32), spanId: "2".repeat(16), sampled: true }),
  tracedFetch: (url: string, init: RequestInit) => fetch(url, init),
}));
import { BobGatewayConnector } from "../bob-gateway";
import { BobRunReporter } from "../bob-run-reporter";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each(["worktree", "missing-directory"])("retains an automatic failed run and trace when %s setup fails", async (failure) => {
  const dir = mkdtempSync(join(tmpdir(), "bob-setup-report-")); dirs.push(dir);
  mkdirSync(join(dir, ".git"));
  const calls: Array<{ url: string; body: Record<string, any> }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "run-setup" });
  });
  const connector = Object.create(BobGatewayConnector.prototype) as Record<string, any>;
  Object.assign(connector, {
    config: { maxConcurrent: 1 }, activeSessions: new Map(), adapters: new Map(),
    canRunAgent: () => true,
    sendDurable: vi.fn(), sendStatus: vi.fn(), sendEvent: vi.fn(),
    detectBaseBranch: vi.fn().mockResolvedValue("main"),
    setupWorktree: vi.fn().mockRejectedValue(new Error("fixture branch collision")),
    resolveWorkDir: () => join(dir, "absent"),
    runWithCli: vi.fn(),
    bobReporter: new BobRunReporter({ baseUrl: "https://bob.example", apiKey: "fixture-key", workspaceId: "owned-workspace" }),
  });
  await connector.handleSessionAvailable({
    type: "session_available", sessionId: "owned-session", workItemId: "owned-item",
    workspaceId: "owned-workspace", workingDirectory: dir, agentType: "codex",
    ...(failure === "worktree" ? { branch: "bob/run-fixture" } : {}),
  });
  expect(calls.find((call) => call.url.endsWith("/api/v1/runs"))?.body).toMatchObject({
    workItemId: "owned-item", agentConfig: { sessionId: "owned-session" },
  });
  expect(calls.some((call) => call.url.endsWith("/artifacts") && call.body.metadata?.kind === "trace_reference")).toBe(true);
  expect(calls.filter((call) => call.url.endsWith("/runs/run-setup")).at(-1)?.body).toMatchObject({ status: "failed" });
  expect(connector.activeSessions.size).toBe(0);
  expect(connector.runWithCli).not.toHaveBeenCalled();
});
