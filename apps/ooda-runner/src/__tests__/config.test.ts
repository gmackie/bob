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
});
