import { describe, expect, it } from "vitest";

import {
  createIntegrationInputSchema,
  updateIntegrationInputSchema,
} from "../src/routers/integration";
import { updateProjectInputSchema } from "../src/routers/project";

describe("Bob integration settings schemas", () => {
  it("accepts a Bob workspace integration config", () => {
    const result = createIntegrationInputSchema.safeParse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      type: "bob",
      name: "Bob",
      settings: {
        baseUrl: "https://bob.example.internal",
        sharedSecret: "super-secret",
        launchPolicy: "auto_or_manual",
        defaultAwaitingInputTimeoutMinutes: 30,
        commentMirroring: "milestones_only",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid Bob integration config", () => {
    const result = createIntegrationInputSchema.safeParse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      type: "bob",
      name: "Bob",
      settings: {
        baseUrl: "not-a-url",
        launchPolicy: "invalid",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts Bob integration updates", () => {
    const result = updateIntegrationInputSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440001",
      settings: {
        baseUrl: "https://bob.example.internal",
        sharedSecret: "rotated-secret",
        defaultAwaitingInputTimeoutMinutes: 45,
      },
      enabled: true,
    });

    expect(result.success).toBe(true);
  });
});

describe("Bob project override schemas", () => {
  it("accepts project-level Bob overrides", () => {
    const result = updateProjectInputSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440002",
      bobLaunchPolicy: "manual_only",
      bobAwaitingInputTimeoutMinutes: 120,
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid Bob project overrides", () => {
    const result = updateProjectInputSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440002",
      bobLaunchPolicy: "launch-whatever",
      bobAwaitingInputTimeoutMinutes: 0,
    });

    expect(result.success).toBe(false);
  });
});
