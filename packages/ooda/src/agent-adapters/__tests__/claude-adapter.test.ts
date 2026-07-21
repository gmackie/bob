import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../claude-adapter";
import type { AdapterEvent, AdapterProcessHandle } from "../types";

// Fake claude CLI: for each stream-json user message on stdin, emits a
// `result` line after a short delay; exits when stdin closes (mirroring
// the real CLI's --input-format stream-json behavior).
const FAKE_CLAUDE = `
const rl = require('readline').createInterface({ input: process.stdin });
let pending = 0;
let closed = false;
rl.on('line', (l) => {
  pending++;
  const msg = JSON.parse(l);
  setTimeout(() => {
    console.log(JSON.stringify({ type: 'result', result: 'echo:' + msg.message.content }));
    pending--;
    if (closed && pending === 0) process.exit(0);
  }, 150);
});
rl.on('close', () => {
  closed = true;
  if (pending === 0) process.exit(0);
});
`;

// Fake agent that produces no output and never exits on its own — for kill tests.
const HANG_FOREVER = `setInterval(() => {}, 1000);`;

// Fake claude that MERGES queued messages into the current turn: emits a
// single result no matter how many user messages arrive (the behavior the
// real CLI showed for mid-turn steering in production).
const MERGING_CLAUDE = `
let first = true;
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', () => {
  if (!first) return;
  first = false;
  setTimeout(() => console.log(JSON.stringify({ type: 'result', result: 'merged' })), 250);
});
rl.on('close', () => process.exit(0));
`;

process.env.CLAUDE_STDIN_IDLE_CLOSE_MS = "150";

function fakeCommand(script: string, prompt?: string) {
  return {
    binary: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    prompt,
  };
}

function collectResults(events: AdapterEvent[]): string[] {
  return events
    .filter((e) => e.type === "stdout")
    .flatMap((e) => e.data.split("\n"))
    .filter((l) => l.includes('"type":"result"'));
}

describe("ClaudeAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new ClaudeAdapter();

    expect(adapter.id).toBe("claude");
    expect(adapter.name).toBe("Claude Code");
    expect(adapter.transport).toBe("api");
  });

  it("is available when ANTHROPIC_API_KEY is set", () => {
    const adapter = new ClaudeAdapter();

    const originalEnv = process.env.ANTHROPIC_API_KEY;

    // With the env var, always available
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(adapter.isAvailable()).toBe(true);

    // Without the env var, availability depends on whether the
    // claude binary is on PATH — just verify it returns a boolean
    delete process.env.ANTHROPIC_API_KEY;
    expect(typeof adapter.isAvailable()).toBe("boolean");

    // Restore
    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("builds a stream-json command with the prompt carried out-of-argv", () => {
    const adapter = new ClaudeAdapter();

    const command = adapter.buildCommand({
      prompt: "Research sleep optimization",
      workspaceRoot: "/tmp/threads/sleep",
      systemPrompt: "You are a research assistant.",
    });

    expect(command.binary).toBe("claude");
    expect(command.args).toContain("-p");
    expect(command.args).toContain("--input-format");
    expect(command.args).toContain("stream-json");
    // Prompt goes over stdin (so follow-up turns can too), not argv
    expect(command.args).not.toContain("Research sleep optimization");
    expect(command.prompt).toBe("Research sleep optimization");
    expect(command.cwd).toBe("/tmp/threads/sleep");
  });

  it("applies persona model and allowedTools to the CLI args", () => {
    const adapter = new ClaudeAdapter();

    const command = adapter.buildCommand({
      prompt: "do the thing",
      workspaceRoot: "/tmp/ws",
      model: "claude-sonnet-5",
      allowedTools: ["Read", "Bash"],
    });

    const modelIdx = command.args.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(command.args[modelIdx + 1]).toBe("claude-sonnet-5");

    const toolsIdx = command.args.indexOf("--allowedTools");
    expect(toolsIdx).toBeGreaterThan(-1);
    expect(command.args[toolsIdx + 1]).toBe("Read,Bash");
  });

  it("omits model/tools flags when the persona doesn't set them", () => {
    const adapter = new ClaudeAdapter();
    const command = adapter.buildCommand({
      prompt: "x",
      workspaceRoot: "/tmp/ws",
    });
    expect(command.args).not.toContain("--model");
    expect(command.args).not.toContain("--allowedTools");
  });

  it("runs a single-prompt session to completion (stdin closed after the turn)", async () => {
    const adapter = new ClaudeAdapter();
    const events: AdapterEvent[] = [];

    const { exitCode } = await adapter.execute(
      fakeCommand(FAKE_CLAUDE, "hello"),
      (e) => events.push(e),
    );

    expect(exitCode).toBe(0);
    const results = collectResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("echo:hello");
  });

  it("processes a steering message written mid-run as a second turn", async () => {
    const adapter = new ClaudeAdapter();
    const events: AdapterEvent[] = [];
    let handle: AdapterProcessHandle | undefined;

    const done = adapter.execute(
      fakeCommand(FAKE_CLAUDE, "first"),
      (e) => events.push(e),
      { onSpawn: (h) => (handle = h) },
    );

    // Steer while the first turn is still in flight (fake takes 150ms)
    await new Promise((r) => setTimeout(r, 50));
    expect(handle?.write("second")).toBe(true);

    const { exitCode } = await done;
    expect(exitCode).toBe(0);
    const results = collectResults(events);
    expect(results).toHaveLength(2);
    expect(results[1]).toContain("echo:second");
  });

  it("exits after one result even when the CLI merges a steer into the current turn", async () => {
    const adapter = new ClaudeAdapter();
    const events: AdapterEvent[] = [];
    let handle: AdapterProcessHandle | undefined;

    const done = adapter.execute(
      fakeCommand(MERGING_CLAUDE, "first"),
      (e) => events.push(e),
      { onSpawn: (h) => (handle = h) },
    );

    // Steer mid-turn; the fake merges it — only ONE result ever comes.
    await new Promise((r) => setTimeout(r, 50));
    expect(handle?.write("second")).toBe(true);

    // Regression: with turn-counting this would hang forever (2 writes, 1 result).
    const { exitCode } = await done;
    expect(exitCode).toBe(0);
    expect(collectResults(events)).toHaveLength(1);
  });

  it("rejects writes after the session has wound down", async () => {
    const adapter = new ClaudeAdapter();
    let handle: AdapterProcessHandle | undefined;

    await adapter.execute(fakeCommand(FAKE_CLAUDE, "only"), () => {}, {
      onSpawn: (h) => (handle = h),
    });

    expect(handle?.write("too late")).toBe(false);
  });

  it("kill() terminates a hung agent and reports exit 130", async () => {
    const adapter = new ClaudeAdapter();
    let handle: AdapterProcessHandle | undefined;

    const done = adapter.execute(fakeCommand(HANG_FOREVER, "hang"), () => {}, {
      onSpawn: (h) => (handle = h),
    });

    await new Promise((r) => setTimeout(r, 50));
    handle?.kill();

    const { exitCode } = await done;
    expect(exitCode).toBe(130);
  });

  describe("permission mode", () => {
    // Fake claude that asks permission for its first tool call: emits a
    // control_request(can_use_tool), waits for the control_response on stdin,
    // then emits a result reflecting the decision and exits when stdin closes.
    const PERMISSION_CLAUDE = `
const rl = require('readline').createInterface({ input: process.stdin });
let asked = false;
rl.on('line', (l) => {
  const msg = JSON.parse(l);
  if (msg.type === 'control_response') {
    const behavior = msg.response.response.behavior;
    console.log(JSON.stringify({ type: 'result', result: 'decision:' + behavior }));
    return;
  }
  if (!asked) {
    asked = true;
    console.log(JSON.stringify({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf /' } },
    }));
  }
});
rl.on('close', () => process.exit(0));
`;

    it("defaults to prompt mode (no blanket bypass) and supports skip for full autonomy", () => {
      const adapter = new ClaudeAdapter();
      const prompt = adapter.buildCommand({ prompt: "p", workspaceRoot: "/tmp" });
      expect(prompt.args).not.toContain("--dangerously-skip-permissions");

      const skip = adapter.buildCommand({
        prompt: "p",
        workspaceRoot: "/tmp",
        permissionMode: "skip",
      });
      expect(skip.args).toContain("--dangerously-skip-permissions");
    });

    it("routes prompt-mode permissions onto the control channel via --permission-prompt-tool stdio", () => {
      const adapter = new ClaudeAdapter();
      const prompt = adapter.buildCommand({ prompt: "p", workspaceRoot: "/tmp" });

      const idx = prompt.args.indexOf("--permission-prompt-tool");
      expect(idx).toBeGreaterThan(-1);
      expect(prompt.args[idx + 1]).toBe("stdio");

      // skip mode must not carry the prompt-tool flag alongside the bypass.
      const skip = adapter.buildCommand({
        prompt: "p",
        workspaceRoot: "/tmp",
        permissionMode: "skip",
      });
      expect(skip.args).not.toContain("--permission-prompt-tool");
    });

    it("honors the CLAUDE_PERMISSION_PROMPT_ARGS override (version-probed CLI boundary)", () => {
      const prev = process.env.CLAUDE_PERMISSION_PROMPT_ARGS;
      process.env.CLAUDE_PERMISSION_PROMPT_ARGS = "--permission-mode ask  --extra";
      try {
        const adapter = new ClaudeAdapter();
        const prompt = adapter.buildCommand({ prompt: "p", workspaceRoot: "/tmp" });
        expect(prompt.args).toContain("--permission-mode");
        expect(prompt.args).toContain("ask");
        // double space must not inject empty argv entries
        expect(prompt.args).toContain("--extra");
        expect(prompt.args).not.toContain("");
        expect(prompt.args).not.toContain("--permission-prompt-tool");
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_PERMISSION_PROMPT_ARGS;
        else process.env.CLAUDE_PERMISSION_PROMPT_ARGS = prev;
      }
    });

    it("surfaces a control_request as permission_request, pauses past the idle window, and resumes on allow", async () => {
      const adapter = new ClaudeAdapter();
      const events: AdapterEvent[] = [];
      let handle: AdapterProcessHandle | undefined;

      const done = adapter.execute(
        fakeCommand(PERMISSION_CLAUDE, "do something dangerous"),
        (e) => events.push(e),
        { onSpawn: (h) => (handle = h) },
      );

      // Wait for the permission_request event.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (events.some((e) => e.type === "permission_request")) resolve();
          else setTimeout(check, 25);
        };
        check();
      });
      const req = events.find((e) => e.type === "permission_request")!;
      expect(req.permission?.requestId).toBe("req-1");
      expect(req.permission?.toolName).toBe("Bash");

      // Sit well past the idle-close window (150ms in this suite): the run
      // must stay alive while the request is pending — an unapproved run is
      // paused, never silently expired.
      await new Promise((r) => setTimeout(r, 500));
      expect(events.some((e) => e.type === "exit")).toBe(false);

      // Approve. The fake CLI emits a result reflecting the decision, the
      // idle timer re-arms, stdin closes, and the run completes cleanly.
      expect(handle?.respondPermission?.("req-1", "allow")).toBe(true);
      // Idempotency: a double-send of the same decision resolves once.
      expect(handle?.respondPermission?.("req-1", "allow")).toBe(false);

      const { exitCode } = await done;
      expect(exitCode).toBe(0);
      expect(collectResults(events).some((l) => l.includes("decision:allow"))).toBe(true);
    });

    it("deny resolves the request with behavior deny", async () => {
      const adapter = new ClaudeAdapter();
      const events: AdapterEvent[] = [];
      let handle: AdapterProcessHandle | undefined;

      const done = adapter.execute(
        fakeCommand(PERMISSION_CLAUDE, "do something dangerous"),
        (e) => events.push(e),
        { onSpawn: (h) => (handle = h) },
      );

      await new Promise<void>((resolve) => {
        const check = () => {
          if (events.some((e) => e.type === "permission_request")) resolve();
          else setTimeout(check, 25);
        };
        check();
      });

      expect(handle?.respondPermission?.("req-1", "deny", "not on my box")).toBe(true);
      const { exitCode } = await done;
      expect(exitCode).toBe(0);
      expect(collectResults(events).some((l) => l.includes("decision:deny"))).toBe(true);
    });

    it("respondPermission for an unknown request id returns false", async () => {
      const adapter = new ClaudeAdapter();
      let handle: AdapterProcessHandle | undefined;
      const done = adapter.execute(fakeCommand(FAKE_CLAUDE, "hi"), () => {}, {
        onSpawn: (h) => (handle = h),
      });
      expect(handle?.respondPermission?.("nope", "allow")).toBe(false);
      await done;
    });
  });
});
