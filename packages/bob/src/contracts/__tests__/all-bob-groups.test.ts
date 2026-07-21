import { describe, expect, it } from "vitest";

import { WorkItemsRpc } from "../groups/work-items.js";
import { PlanningRpc } from "../groups/planning.js";
import { ExternalRpc } from "../groups/external.js";

describe("Bob contract groups — Phase 7B-4C verification", () => {
  it("WorkItemsRpc has 33 procedures", () => {
    expect(WorkItemsRpc.requests.size).toBe(33);
  });

  it("PlanningRpc has 68 procedures", () => {
    expect(PlanningRpc.requests.size).toBe(68);
  });

  it("ExternalRpc has 37 procedures", () => {
    expect(ExternalRpc.requests.size).toBe(37);
  });

  it("Bob domain total is 138 procedures", () => {
    const total =
      WorkItemsRpc.requests.size +
      PlanningRpc.requests.size +
      ExternalRpc.requests.size;
    expect(total).toBe(138);
  });
});
