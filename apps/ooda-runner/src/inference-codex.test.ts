import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  output: '{"type":"error","message":"quota exceeded"}\n',
  code: 1,
  args: [] as string[],
}));
vi.mock("node:child_process", () => ({
  spawn: (_binary: string, args: string[]) => {
    state.args = args;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(state.output));
      child.emit("close", state.code);
    });
    return child;
  },
}));
import { completeCodexInference } from "./inference-codex";
afterEach(() => vi.unstubAllEnvs());
it("does not turn Codex error JSON into a successful completion", async () => {
  await expect(completeCodexInference({ prompt: "test" })).rejects.toThrow(
    "Codex inference failed",
  );
});
it("returns only assistant text from a successful Codex execution", async () => {
  state.code = 0;
  state.output =
    '{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}\n';
  await expect(completeCodexInference({ prompt: "test" })).resolves.toBe(
    "answer",
  );
});

it("encodes system instructions using the supported Codex configuration argument", async () => {
  state.code = 0;
  state.output =
    '{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}\n';
  const systemPrompt =
    'Use "quoted" instructions\nPreserve newlines and \u03bb';
  await completeCodexInference({ prompt: "test", systemPrompt });
  expect(state.args).not.toContain("--instructions");
  const index = state.args.indexOf("-c");
  expect(index).toBeGreaterThan(-1);
  expect(state.args[index + 1]).toBe(
    `developer_instructions=${JSON.stringify(systemPrompt)}`,
  );
});
