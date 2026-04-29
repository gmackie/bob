import { describe, expect, it } from "vitest";

import {
  CapabilityDefinitionSchema,
  ToolProfileSchema,
  SourceBundleSchema,
} from "../types";

describe("CapabilityDefinitionSchema", () => {
  it("accepts a read-only source connector", () => {
    const result = CapabilityDefinitionSchema.parse({
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
    });

    expect(result.id).toBe("reddit");
    expect(result.kind).toBe("source_connector");
  });

  it("accepts an agent adapter capability", () => {
    const result = CapabilityDefinitionSchema.parse({
      id: "codex",
      name: "Codex CLI",
      kind: "agent_adapter",
      provider: "openai",
      version: "1.0.0",
      description: "Codex CLI agent adapter",
      tags: ["agent"],
      trustLevel: "local",
      executionScope: "local_only",
      defaultAccessMode: "read_write",
      authRequirements: ["OPENAI_API_KEY"],
      supportsProvenance: false,
    });

    expect(result.kind).toBe("agent_adapter");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      CapabilityDefinitionSchema.parse({ id: "test" }),
    ).toThrow();
  });
});

describe("ToolProfileSchema", () => {
  it("accepts a tool profile with capability ids", () => {
    const result = ToolProfileSchema.parse({
      id: "research-light",
      name: "Research Light",
      description: "Lightweight research profile",
      capabilityIds: ["reddit", "hacker-news", "crossref"],
    });

    expect(result.capabilityIds).toHaveLength(3);
  });
});

describe("SourceBundleSchema", () => {
  it("accepts a source bundle", () => {
    const result = SourceBundleSchema.parse({
      id: "general-research",
      name: "General Research",
      description: "General-purpose research sources",
      connectorIds: ["reddit", "hacker-news", "crossref", "semantic-scholar"],
    });

    expect(result.connectorIds).toContain("reddit");
  });
});
