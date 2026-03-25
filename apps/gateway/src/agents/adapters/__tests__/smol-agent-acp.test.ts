import { describe, expect, it } from "vitest";

import { getStdioAdapter } from "../base-stdio-adapter.js";
import { createSmolAgentAcpAdapter } from "../smol-agent-acp.js";

describe("smol-agent ACP adapter", () => {
  it("registers a gateway adapter for smol-agent", () => {
    const adapter = getStdioAdapter("smol-agent", "/tmp/project");

    expect(adapter).not.toBeNull();
    expect(adapter?.command).toBe("smol-agent");
    expect(adapter?.args).toEqual(["--acp", "--directory", "/tmp/project"]);
  });

  it("bootstraps ACP with initialize and session/new before the first prompt", () => {
    const adapter = createSmolAgentAcpAdapter("/tmp/project");
    const payload = adapter.formatInput("Implement the task");

    expect(payload).toContain("\"method\":\"initialize\"");
    expect(payload).toContain("\"method\":\"session/new\"");
    expect(payload).not.toContain("\"method\":\"session/prompt\"");
  });

  it("emits a follow-up prompt once the ACP session id arrives", () => {
    const adapter = createSmolAgentAcpAdapter("/tmp/project");
    adapter.formatInput("Implement the task");

    const event = adapter.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { sessionId: "acp-session-1" },
      }),
    );

    expect(event).toEqual({
      type: "status",
      data: {
        status: "session_ready",
        sessionId: "acp-session-1",
        followUpInput: expect.stringContaining("\"method\":\"session/prompt\""),
      },
    });
  });

  it("parses ACP agent message chunks into gateway output events", () => {
    const adapter = createSmolAgentAcpAdapter("/tmp/project");

    const event = adapter.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello from smol-agent" },
          },
        },
      }),
    );

    expect(event).toEqual({
      type: "output",
      data: { text: "hello from smol-agent" },
    });
  });
});
