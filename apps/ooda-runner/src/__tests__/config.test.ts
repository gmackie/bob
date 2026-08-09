import { describe, expect, it } from "vitest";

import { RunnerConfigSchema } from "../config";

describe("RunnerConfigSchema", () => {
  it("keeps Bob durable delivery dark unless explicitly enabled", () => {
    expect(RunnerConfigSchema.parse({}).bobDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ bobDeliveryEnabled: "true" })
        .bobDeliveryEnabled,
    ).toBe(true);
  });

  it("enables the subscription host worker by default and allows a kill switch", () => {
    expect(RunnerConfigSchema.parse({}).hostTurnEnabled).toBe(true);
    expect(
      RunnerConfigSchema.parse({ hostTurnEnabled: "false" }).hostTurnEnabled,
    ).toBe(false);
  });

  it("keeps Obsidian writes behind an adapter kill switch", () => {
    expect(RunnerConfigSchema.parse({}).obsidianDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ obsidianDeliveryEnabled: "true" })
        .obsidianDeliveryEnabled,
    ).toBe(true);
  });

  it("keeps BizPulse venture creation behind an adapter kill switch", () => {
    expect(RunnerConfigSchema.parse({}).bizPulseDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ bizPulseDeliveryEnabled: "true" })
        .bizPulseDeliveryEnabled,
    ).toBe(true);
  });

  it("keeps Creator project creation behind an adapter kill switch", () => {
    expect(RunnerConfigSchema.parse({}).creatorDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ creatorDeliveryEnabled: "true" })
        .creatorDeliveryEnabled,
    ).toBe(true);
  });

  it("keeps FabForge candidate intake behind an adapter kill switch", () => {
    expect(RunnerConfigSchema.parse({}).fabForgeDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ fabForgeDeliveryEnabled: "true" })
        .fabForgeDeliveryEnabled,
    ).toBe(true);
  });

  it("keeps Veritas project intake behind an adapter kill switch", () => {
    expect(RunnerConfigSchema.parse({}).veritasDeliveryEnabled).toBe(false);
    expect(
      RunnerConfigSchema.parse({ veritasDeliveryEnabled: "true" })
        .veritasDeliveryEnabled,
    ).toBe(true);
  });
});
