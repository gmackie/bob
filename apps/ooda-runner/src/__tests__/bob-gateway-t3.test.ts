import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { BobGatewayConnector } from "../bob-gateway";
import { spawnSupervised } from "../supervisor";
import { RunnerConfigSchema } from "../config";

vi.mock("../supervisor", () => ({ spawnSupervised: vi.fn() }));

it("requires credentials before enabling T3 execution", () => {
  expect(RunnerConfigSchema.safeParse({ t3codeServerUrl: "http://localhost:3773" }).success).toBe(false);
});

it("runs the bridge under the restart-safe supervisor and retains remote controls", async () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: vi.fn() } });
  vi.mocked(spawnSupervised).mockReturnValue(proc as never);
  // Test the real handoff seam without opening an unrelated gateway connection.
  const connector = Object.create(BobGatewayConnector.prototype);
  Object.assign(connector, {
    config: { t3: { serverUrl: "http://localhost:3773", authToken: "test-token" } },
    supervisedSessions: new Set(), sessionHandles: new Map(),
    superviseDir: () => "/tmp/bob-t3-test-session", forwardAdapterEvent: vi.fn(),
    permissionModeFor: () => "prompt", buildSystemPrompt: () => "Project instructions",
  });
  const worktree = { path: "/work/BOB-40", repoPath: "/repos/bob", branch: "BOB-40", baseBranch: "master" };
  const collect = vi.fn();
  const result = connector.runWithT3({ sessionId: "s1", agentType: "codex", title: "BOB-40" }, worktree.path, "Task text", collect, worktree);
  const [, meta, , args, options] = vi.mocked(spawnSupervised).mock.calls[0]!;
  expect(meta).toMatchObject({ runtime: "t3", sessionId: "s1", worktree });
  expect(args.at(-1)).toMatch(/t3-bridge.ts$/);
  expect(JSON.parse(options.env.BOB_T3_TASK!)).toMatchObject({ repoPath: "/repos/bob", worktreePath: "/work/BOB-40", providerInstanceId: "codex", runtimeMode: "approval-required", prompt: "Project instructions\n\nTask text" });
  proc.stdout.emit("data", Buffer.from('{"type":"control_request","request_id":"a1","request":{"subtype":"can_use_tool","tool_name":"command"}}\n'));
  const handle = connector.sessionHandles.get("s1");
  expect(handle.respondPermission("a1", "deny", "No")).toBe(true);
  handle.kill();
  expect(proc.stdin.write).toHaveBeenLastCalledWith('{"type":"stop"}\n');
  proc.emit("close", 0);
  await result;
  expect(collect).toHaveBeenCalled();
  expect(connector.canRunAgent("codex")).toBe(true);
});
