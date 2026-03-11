import { describe, expect, it } from "vitest";
import {
  forgeBuildTriggerInputSchema,
  isTerminalBuildStatus,
} from "../src/routers/forge-build";

describe("ForgeGraph build trigger idempotency primitives", () => {
  it("requires idempotency key", () => {
    const parsed = forgeBuildTriggerInputSchema.safeParse({
      repoId: "repo-a",
      revId: "rev-a",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts valid trigger with idempotency key", () => {
    const parsed = forgeBuildTriggerInputSchema.safeParse({
      repoId: "repo-a",
      revId: "rev-a",
      idempotencyKey: "repo-a:rev-a:validate",
      runId: "run-a",
    });

    expect(parsed.success).toBe(true);
  });

  it("identifies terminal build statuses", () => {
    expect(isTerminalBuildStatus("passed")).toBe(true);
    expect(isTerminalBuildStatus("failed")).toBe(true);
    expect(isTerminalBuildStatus("canceled")).toBe(true);
    expect(isTerminalBuildStatus("superseded")).toBe(true);
    expect(isTerminalBuildStatus("running")).toBe(false);
    expect(isTerminalBuildStatus("queued")).toBe(false);
  });
});
