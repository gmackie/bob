import { describe, expect, it } from "vitest";

import { CapabilityRegistry } from "../registry";
import type { CapabilityDefinition, ToolProfile } from "../types";

const REDDIT: CapabilityDefinition = {
  id: "reddit",
  name: "Reddit",
  kind: "source_connector",
  provider: "reddit",
  version: "1.0.0",
  description: "Community connector",
  tags: ["community"],
  trustLevel: "reviewed",
  executionScope: "remote_ok",
  defaultAccessMode: "read_only",
  authRequirements: [],
  supportsProvenance: true,
};

const CODEX: CapabilityDefinition = {
  id: "codex",
  name: "Codex CLI",
  kind: "agent_adapter",
  provider: "openai",
  version: "1.0.0",
  description: "Codex CLI",
  tags: ["agent"],
  trustLevel: "local",
  executionScope: "local_only",
  defaultAccessMode: "read_write",
  authRequirements: ["OPENAI_API_KEY"],
  supportsProvenance: false,
};

const RESEARCH_LIGHT: ToolProfile = {
  id: "research-light",
  name: "Research Light",
  description: "Lightweight research",
  capabilityIds: ["reddit"],
};

describe("CapabilityRegistry", () => {
  it("registers and retrieves capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(REDDIT);
    registry.registerCapability(CODEX);

    expect(registry.getCapability("reddit")).toEqual(REDDIT);
    expect(registry.getCapability("codex")).toEqual(CODEX);
  });

  it("lists capabilities for a tool profile", () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(REDDIT);
    registry.registerCapability(CODEX);
    registry.registerProfile(RESEARCH_LIGHT);

    const caps = registry.listForProfile("research-light");
    expect(caps.map((c) => c.id)).toEqual(["reddit"]);
  });

  it("returns undefined for unknown capability", () => {
    const registry = new CapabilityRegistry();
    expect(registry.getCapability("nonexistent")).toBeUndefined();
  });

  it("throws on duplicate capability registration", () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(REDDIT);
    expect(() => registry.registerCapability(REDDIT)).toThrow();
  });
});
