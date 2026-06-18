import { describe, it, expect } from "vitest";

import {
  AdapterExitError,
  AdapterSpawnError,
  type AgentEvent,
} from "../adapter.js";

describe("@gmacko/agent adapter contract", () => {
  it("tagged errors expose _tag + fields round-tripped through the constructor", () => {
    const spawn = new AdapterSpawnError({
      adapterId: "claude-code",
      message: "binary not found",
    });
    expect(spawn._tag).toBe("AdapterSpawnError");
    expect(spawn.adapterId).toBe("claude-code");
    expect(spawn.message).toBe("binary not found");

    const exit = new AdapterExitError({
      adapterId: "claude-code",
      code: 1,
      stderr: "boom",
    });
    expect(exit._tag).toBe("AdapterExitError");
    expect(exit.adapterId).toBe("claude-code");
    expect(exit.code).toBe(1);
    expect(exit.stderr).toBe("boom");
  });

  it("AgentEvent is a discriminated union — `type` narrows payload fields at runtime", () => {
    // Tiny narrowing helper: proves TypeScript narrows per `type` tag and
    // that the discriminator survives at runtime.
    const eventText = (e: AgentEvent): string | null =>
      e.type === "text_delta" ? e.text : null;

    const textEvent: AgentEvent = { type: "text_delta", text: "hi" };
    const endEvent: AgentEvent = { type: "turn_end", stopReason: "end_turn" };
    expect(eventText(textEvent)).toBe("hi");
    expect(eventText(endEvent)).toBeNull();
  });
});
