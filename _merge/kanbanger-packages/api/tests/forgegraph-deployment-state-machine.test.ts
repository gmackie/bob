import { describe, expect, it } from "vitest";
import { canTransitionDeploymentStatus } from "../src/routers/forge-deployment";

describe("ForgeGraph deployment state machine", () => {
  it("allows pending_approval -> deploying -> healthy", () => {
    expect(canTransitionDeploymentStatus("pending_approval", "deploying")).toBe(true);
    expect(canTransitionDeploymentStatus("deploying", "healthy")).toBe(true);
  });

  it("allows queued -> building -> testing -> deploying -> verifying -> healthy", () => {
    expect(canTransitionDeploymentStatus("pending_approval", "queued")).toBe(true);
    expect(canTransitionDeploymentStatus("queued", "building")).toBe(true);
    expect(canTransitionDeploymentStatus("building", "testing")).toBe(true);
    expect(canTransitionDeploymentStatus("testing", "deploying")).toBe(true);
    expect(canTransitionDeploymentStatus("deploying", "verifying")).toBe(true);
    expect(canTransitionDeploymentStatus("verifying", "healthy")).toBe(true);
  });

  it("allows deploying -> unhealthy -> rolled_back", () => {
    expect(canTransitionDeploymentStatus("deploying", "unhealthy")).toBe(true);
    expect(canTransitionDeploymentStatus("unhealthy", "rolled_back")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionDeploymentStatus("pending_approval", "healthy")).toBe(false);
    expect(canTransitionDeploymentStatus("rolled_back", "deploying")).toBe(false);
    expect(canTransitionDeploymentStatus("failed", "healthy")).toBe(false);
  });
});
