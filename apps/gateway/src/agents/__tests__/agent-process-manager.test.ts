import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { fileURLToPath } from "url";
import { AgentProcessManager } from "../agent-process-manager.js";
import type { StdioAdapter, ParsedEvent } from "../adapters/base-stdio-adapter.js";

// Mock getStdioAdapter to return our test adapter
vi.mock("../adapters/base-stdio-adapter.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../adapters/base-stdio-adapter.js")>();
  return {
    ...orig,
    getStdioAdapter: (agentType: string, _workingDirectory: string): StdioAdapter | null => {
      if (agentType === "mock") {
        return createMockAdapter();
      }
      return null;
    },
  };
});

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function createMockAdapter(): StdioAdapter {
  return {
    command: "node",
    args: [join(__dirname, "mock-agent.mjs")],
    env: {},
    parseLine(line: string): ParsedEvent | null {
      try {
        const msg = JSON.parse(line);
        if (msg.method === "events.output") {
          return { type: "output", data: { text: msg.params?.content ?? "" } };
        }
        if (msg.method === "events.toolCall") {
          return {
            type: "tool_call",
            data: {
              toolCallId: msg.params?.id ?? "",
              name: msg.params?.name ?? "",
              arguments: JSON.stringify(msg.params?.args ?? {}),
            },
          };
        }
        if (msg.method === "events.toolResult") {
          return {
            type: "tool_result",
            data: {
              toolCallId: msg.params?.id ?? "",
              result: msg.params?.result ?? "",
              isError: false,
            },
          };
        }
      } catch {}
      return null;
    },
    formatInput(message: string): string {
      // If the message looks like JSON already, pass it through raw
      if (message.startsWith("{")) {
        return message + "\n";
      }
      return JSON.stringify({ jsonrpc: "2.0", method: "chat.send", params: { message } }) + "\n";
    },
  };
}

function createMockActor() {
  return {
    handleAgentOutput: vi.fn(),
    handleToolCall: vi.fn(),
    handleToolResult: vi.fn(),
    handleAgentExit: vi.fn(),
    setStatus: vi.fn(),
    sessionId: "test-session",
    agentType: "mock",
    workingDirectory: "/tmp",
    // Extra props from SessionActor that may be called
    userId: "test-user",
  };
}

describe("AgentProcessManager", () => {
  let manager: AgentProcessManager;
  let actor: ReturnType<typeof createMockActor>;

  beforeEach(() => {
    manager = new AgentProcessManager();
    actor = createMockActor();
  });

  afterEach(async () => {
    manager.destroy();
    // Give child processes time to exit
    await new Promise((r) => setTimeout(r, 200));
  });

  it("starts a session with the mock agent and receives output events", async () => {
    await manager.startSession({
      sessionId: "test-1",
      agentType: "mock",
      workingDirectory: "/tmp",
      initialPrompt: '{"jsonrpc":"2.0","method":"session.start","params":{}}',
      actor: actor as any,
    });

    expect(manager.isManaging("test-1")).toBe(true);
    expect(actor.setStatus).toHaveBeenCalledWith("starting");
    expect(actor.setStatus).toHaveBeenCalledWith("running");

    // Wait for mock agent to process the session.start and emit events
    await new Promise((r) => setTimeout(r, 500));

    // The mock agent sends 4 lines for session.start:
    // 1. events.output "Mock agent started" → handleAgentOutput
    // 2. events.toolCall → handleToolCall
    // 3. events.toolResult → handleToolResult
    // 4. events.output "Done!" → handleAgentOutput
    expect(actor.handleAgentOutput).toHaveBeenCalled();
    expect(actor.handleToolCall).toHaveBeenCalled();
    expect(actor.handleToolResult).toHaveBeenCalled();

    await manager.stopSession("test-1");
  });

  it("sends input and receives echo response", async () => {
    await manager.startSession({
      sessionId: "test-2",
      agentType: "mock",
      workingDirectory: "/tmp",
      actor: actor as any,
    });

    // Send a chat message
    const sent = manager.sendInput("test-2", "hello world");
    expect(sent).toBe(true);

    // Wait for the mock agent to respond
    await new Promise((r) => setTimeout(r, 500));

    // The mock agent echoes back via events.output
    const outputCalls = actor.handleAgentOutput.mock.calls;
    const echoCall = outputCalls.find((c: unknown[]) => (c[0] as string).includes("Echo: hello world"));
    expect(echoCall).toBeDefined();

    await manager.stopSession("test-2");
  });

  it("stops a session and cleans up", async () => {
    await manager.startSession({
      sessionId: "test-3",
      agentType: "mock",
      workingDirectory: "/tmp",
      actor: actor as any,
    });

    expect(manager.isManaging("test-3")).toBe(true);

    await manager.stopSession("test-3");

    // After stopping, session should no longer be managed
    expect(manager.isManaging("test-3")).toBe(false);

    // handleAgentExit should have been called
    expect(actor.handleAgentExit).toHaveBeenCalled();
  });

  it("isManaging returns true for active sessions and false for unknown", () => {
    expect(manager.isManaging("nonexistent")).toBe(false);
  });

  it("sendInput returns false for unknown sessions", () => {
    expect(manager.sendInput("nonexistent", "hello")).toBe(false);
  });

  it("getStatus returns correct status", async () => {
    expect(manager.getStatus("nonexistent")).toBe("not_found");

    await manager.startSession({
      sessionId: "test-status",
      agentType: "mock",
      workingDirectory: "/tmp",
      actor: actor as any,
    });

    expect(manager.getStatus("test-status")).toBe("running");

    await manager.stopSession("test-status");
  });
});
