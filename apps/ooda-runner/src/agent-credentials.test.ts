import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCredentials } from "./agent-credentials.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<object>(),
  spawn: vi.fn(),
}));

let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let dir: string;
let sent: Record<string, unknown>[];
let creds: AgentCredentials;

beforeEach(() => {
  vi.mocked(spawn).mockImplementation(() => {
    child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    return child as unknown as ReturnType<typeof spawn>;
  });
  dir = mkdtempSync(join(tmpdir(), "ooda-creds-"));
  process.env.BOB_CREDIT_STATE_PATH = join(dir, "credit-state.json");
  sent = [];
  creds = new AgentCredentials({
    hostId: "test-host",
    daemonVersion: "test",
    send: (msg) => sent.push(msg),
    queueDepth: () => 3,
    // Stubbed: probing the real CLIs would make these tests depend on this
    // machine's login state and on network timing.
    run: (_command, args) =>
      Promise.resolve(
        args.includes("--version")
          ? { code: 0, stdout: "stub 1.0", stderr: "" }
          : { code: 0, stdout: "authenticated", stderr: "" },
      ),
  });
});

afterEach(() => {
  creds.shutdown();
  delete process.env.BOB_CREDIT_STATE_PATH;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("AgentCredentials", () => {
  it("builds a host snapshot for every known provider", async () => {
    const snapshot = await creds.hostSnapshot();

    expect(snapshot.hostId).toBe("test-host");
    expect(snapshot.queueDepth).toBe(3);
    expect(snapshot.providers.map((p) => p.provider).sort()).toEqual(
      ["claude", "codex", "cursor-agent", "grok"].sort(),
    );
  });

  it("latches no_credit from a 402 and reports it in the next snapshot", async () => {
    // The 2026-08-29 regression, end to end through this wrapper: the probe
    // cannot see an exhausted balance, so only a real run outcome can.
    creds.noteRunOutcome("grok", 1, "402 Payment Required — Grok Build usage balance exhausted");

    const grok = (await creds.hostSnapshot(true)).providers.find((p) => p.provider === "grok");
    expect(grok?.status).toBe("no_credit");
    expect(grok?.detail).toContain("usage balance exhausted");
  });

  it("clears the latch after a successful run", async () => {
    creds.noteRunOutcome("grok", 1, "402 Payment Required");
    creds.noteRunOutcome("grok", 0, "done");

    const grok = (await creds.hostSnapshot(true)).providers.find((p) => p.provider === "grok");
    expect(grok?.status).not.toBe("no_credit");
  });

  it("ignores outcomes for agent types that are not providers", () => {
    expect(() => creds.noteRunOutcome("not-a-provider", 1, "402 Payment Required")).not.toThrow();
  });

  it("does not latch a rate limit as an exhausted balance", async () => {
    creds.noteRunOutcome("grok", 1, "429 Too Many Requests: rate limit exceeded");

    const grok = (await creds.hostSnapshot(true)).providers.find((p) => p.provider === "grok");
    expect(grok?.status).not.toBe("no_credit");
  });

  it("reports a failure result for an unknown provider rather than going silent", () => {
    creds.startAuth("req-1", "not-a-provider");

    expect(sent.at(-1)).toMatchObject({
      type: "agent_auth_result",
      requestId: "req-1",
      ok: false,
    });
  });

  it("lets a second sign-in supersede an abandoned one", () => {
    // Changed 2026-08-30 after a production report: refusing here locked the
    // operator out of codex entirely, because cancel() needs the original
    // requestId and the UI mints a fresh one per click. Clicking Sign in is
    // the operator saying "start over".
    creds.startAuth("req-1", "grok");
    sent.length = 0;
    creds.startAuth("req-2", "grok");

    // The abandoned request is told it was cancelled; the new one proceeds.
    expect(sent.some((m) => m.requestId === "req-1" && m.status === "cancelled")).toBe(true);
    expect(sent.some((m) => m.type === "agent_auth_result" && m.requestId === "req-2" && m.ok === false)).toBe(false);
  });

  it("reports one failed result when the login executable cannot spawn", () => {
    creds.startAuth("missing-cli", "grok");
    const failure = Object.assign(new Error("spawn grok ENOENT"), { code: "ENOENT" });
    expect(() => child.emit("error", failure)).not.toThrow();
    child.emit("close", -2);
    expect(sent.filter((message) => message.type === "agent_auth_result")).toEqual([
      expect.objectContaining({ requestId: "missing-cli", provider: "grok", ok: false, status: "failed" }),
    ]);
    creds.shutdown();
    expect(sent.filter((message) => message.type === "agent_auth_result")).toHaveLength(1);
  });

  it("handles a real missing login binary without an uncaught child error", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(spawn).mockImplementationOnce(actual.spawn);
    // An empty executable search path guarantees no real provider login runs.
    vi.stubEnv("PATH", dir);
    creds.startAuth("real-missing-cli", "grok");
    await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
      type: "agent_auth_result", requestId: "real-missing-cli", ok: false, status: "failed",
    })));
    expect(sent.filter((message) => message.type === "agent_auth_result")).toHaveLength(1);
  });

  it("ignores a code for an unknown request", () => {
    expect(() => creds.submitCode("nope", "ABCD")).not.toThrow();
  });

  it("reports whether the host's task runner is running", async () => {
    const withDispatch = new AgentCredentials({
      hostId: "test-host",
      daemonVersion: "test",
      send: (msg) => sent.push(msg),
      queueDepth: () => 0,
      run: () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" }),
      dispatchRunning: () => Promise.resolve(true),
    });

    expect((await withDispatch.hostSnapshot()).dispatchRunning).toBe(true);
    withDispatch.shutdown();
  });

  it("leaves dispatchRunning undefined when the state cannot be read", async () => {
    // Undefined must mean "unknown", not "stopped" — the UI offers a Start
    // button off this field, and guessing "stopped" would invite an operator
    // to start a runner that is already up.
    const withFailure = new AgentCredentials({
      hostId: "test-host",
      daemonVersion: "test",
      send: (msg) => sent.push(msg),
      queueDepth: () => 0,
      run: () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" }),
      dispatchRunning: () => Promise.reject(new Error("systemd unreachable")),
    });

    expect((await withFailure.hostSnapshot()).dispatchRunning).toBeUndefined();
    withFailure.shutdown();
  });
});
