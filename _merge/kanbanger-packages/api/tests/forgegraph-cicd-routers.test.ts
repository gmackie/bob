import { describe, expect, it } from "vitest";
import {
  forgeBuildAttachArtifactInputSchema,
  forgeBuildListArtifactsInputSchema,
  forgeBuildTriggerInputSchema,
  forgeBuildUpdateStatusInputSchema,
} from "../src/routers/forge-build";
import {
  forgeDeploymentCreateInputSchema,
  forgeDeploymentUpdateStatusInputSchema,
} from "../src/routers/forge-deployment";

describe("ForgeGraph CI/CD router input schemas", () => {
  it("accepts valid build trigger payload", () => {
    const parsed = forgeBuildTriggerInputSchema.safeParse({
      repoId: "repo-a",
      revId: "rev-a",
      runId: "run-a",
      idempotencyKey: "repo-a:rev-a:validate",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid build status update payload", () => {
    const parsed = forgeBuildUpdateStatusInputSchema.safeParse({
      buildId: "550e8400-e29b-41d4-a716-446655440000",
      status: "running",
      externalJobId: "gh-123",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid artifact attachment payload", () => {
    const parsed = forgeBuildAttachArtifactInputSchema.safeParse({
      buildId: "550e8400-e29b-41d4-a716-446655440000",
      type: "junit",
      storageKey: "artifacts/build/1/junit.xml",
      sizeBytes: 1024,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid build artifact list payload", () => {
    const parsed = forgeBuildListArtifactsInputSchema.safeParse({
      buildId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid deployment create payload", () => {
    const parsed = forgeDeploymentCreateInputSchema.safeParse({
      repoId: "repo-a",
      revId: "rev-a",
      buildId: "550e8400-e29b-41d4-a716-446655440000",
      environment: "staging",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts granular deployment status updates", () => {
    const parsed = forgeDeploymentUpdateStatusInputSchema.safeParse({
      deploymentId: "550e8400-e29b-41d4-a716-446655440000",
      status: "building",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid deployment status", () => {
    const parsed = forgeDeploymentUpdateStatusInputSchema.safeParse({
      deploymentId: "550e8400-e29b-41d4-a716-446655440000",
      status: "done",
    });
    expect(parsed.success).toBe(false);
  });
});
