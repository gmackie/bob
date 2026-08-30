import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentCredentials } from "./agent-credentials.js";

let dir: string;
let sent: Record<string, unknown>[];
let creds: AgentCredentials;

beforeEach(() => {
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

  it("rejects a second concurrent login for the same provider", () => {
    creds.startAuth("req-1", "grok");
    sent.length = 0;
    creds.startAuth("req-2", "grok");

    expect(sent.at(-1)).toMatchObject({ type: "agent_auth_result", requestId: "req-2", ok: false });
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
