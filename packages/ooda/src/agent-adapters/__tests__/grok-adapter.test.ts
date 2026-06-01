import { describe, expect, it } from "vitest";

import { GrokAdapter } from "../grok-adapter";
import { mapSessionUpdate } from "../grok-acp";

describe("GrokAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new GrokAdapter();
    expect(adapter.id).toBe("grok");
    expect(adapter.name).toBe("Grok Build");
    expect(adapter.transport).toBe("stdio");
  });

  it("is available when XAI_API_KEY is set", () => {
    const adapter = new GrokAdapter();
    const original = process.env.XAI_API_KEY;

    process.env.XAI_API_KEY = "xai-test-key";
    expect(adapter.isAvailable()).toBe(true);

    delete process.env.XAI_API_KEY;
    expect(typeof adapter.isAvailable()).toBe("boolean");

    if (original) process.env.XAI_API_KEY = original;
    else delete process.env.XAI_API_KEY;
  });

  it("builds the ACP stdio command with the workspace as cwd and the prompt carried out-of-band", () => {
    const adapter = new GrokAdapter();
    const command = adapter.buildCommand({
      prompt: "Add a hello world endpoint",
      workspaceRoot: "/tmp/threads/api",
    });

    expect(command.binary).toBe("grok");
    // grok's CLI grammar: top-level opts -> `agent` -> agent opts -> `stdio`.
    // `--cwd` is top-level; `--always-approve` is an `agent` option. The
    // `agent stdio` subcommand itself takes no flags. (Verified against
    // grok 0.2.16 on hetzner-bob.)
    expect(command.args).toEqual([
      "--cwd",
      "/tmp/threads/api",
      "agent",
      "--always-approve",
      "stdio",
    ]);
    expect(command.cwd).toBe("/tmp/threads/api");
    // The prompt is sent over ACP (session/prompt), not as a CLI arg.
    expect(command.args).not.toContain("Add a hello world endpoint");
    expect(command.prompt).toBe("Add a hello world endpoint");
  });
});

describe("mapSessionUpdate", () => {
  it("maps an assistant message chunk to a stdout event", () => {
    const event = mapSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello" },
    });
    expect(event?.type).toBe("stdout");
    expect(event?.data).toBe("Hello");
  });

  it("maps an agent thought chunk to a thought event", () => {
    const event = mapSessionUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Let me think" },
    });
    expect(event?.type).toBe("thought");
    expect(event?.thought?.text).toBe("Let me think");
    expect(event?.data).toBe("Let me think");
  });

  it("maps a tool call start to a tool_call event", () => {
    const event = mapSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tc_1",
      title: "Write file",
      kind: "edit",
      status: "in_progress",
      rawInput: { path: "a.ts" },
    });
    expect(event?.type).toBe("tool_call");
    expect(event?.tool?.id).toBe("tc_1");
    expect(event?.tool?.name).toBe("Write file");
    expect(event?.tool?.status).toBe("started");
    expect(event?.tool?.input).toEqual({ path: "a.ts" });
  });

  it("maps a completed tool call update to a tool_result event", () => {
    const event = mapSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc_1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "wrote 3 lines" } }],
    });
    expect(event?.type).toBe("tool_result");
    expect(event?.tool?.id).toBe("tc_1");
    expect(event?.tool?.status).toBe("completed");
    expect(event?.tool?.output).toContain("wrote 3 lines");
  });

  it("maps a failed tool call update to a failed tool_result event", () => {
    const event = mapSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc_2",
      status: "failed",
    });
    expect(event?.type).toBe("tool_result");
    expect(event?.tool?.status).toBe("failed");
  });

  it("returns null for unknown update kinds", () => {
    const event = mapSessionUpdate({ sessionUpdate: "plan" });
    expect(event).toBeNull();
  });
});
