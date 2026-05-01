import { describe, expect, it } from "vitest";

import {
  AdapterCapabilitySchema,
  type AgentAdapter,
  type AdapterEvent,
} from "../types";

describe("AdapterCapabilitySchema", () => {
  it("validates a Codex adapter capability", () => {
    const result = AdapterCapabilitySchema.parse({
      id: "codex",
      name: "Codex CLI",
      transport: "stdio",
      supportedModels: ["codex"],
      requiresApiKey: true,
      apiKeyEnvVar: "OPENAI_API_KEY",
    });

    expect(result.transport).toBe("stdio");
  });

  it("validates a Claude adapter capability", () => {
    const result = AdapterCapabilitySchema.parse({
      id: "claude",
      name: "Claude Code",
      transport: "api",
      supportedModels: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
      requiresApiKey: true,
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });

    expect(result.transport).toBe("api");
  });
});
