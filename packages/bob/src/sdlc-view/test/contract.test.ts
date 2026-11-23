import { describe, expect, it } from "vitest";
import { ITEM_STATES, MILESTONES, PLAN_STATES } from "../src/index";

describe("generated coordinator contract", () => {
  it("lists every coordinator item state", () => {
    expect([...ITEM_STATES].sort()).toEqual(
      ["pending", "ready", "reserved", "running", "waiting-input", "execution-unknown", "validating", "review", "deploying", "failed", "cancelling", "cancelled", "completed"].sort(),
    );
  });
  it("lists plan states and milestones", () => {
    expect([...PLAN_STATES].sort()).toEqual(["active", "cancelled", "cancelling", "completed", "draft", "paused"]);
    expect([...MILESTONES]).toEqual(["execution-succeeded", "review-ready", "merged", "production-verified"]);
  });
});
