import { describe, expect, it } from "vitest";

import { WorkItemsRpc } from "../groups/work-items.js";
import { PlanningRpc } from "../groups/planning.js";
import { ExternalRpc } from "../groups/external.js";

describe("Bob contract groups — Phase 7B-4C verification", () => {
  it("WorkItemsRpc has 31 procedures", () => {
    expect(WorkItemsRpc.requests.size).toBe(31);
  });

  it("PlanningRpc has 67 procedures", () => {
    expect(PlanningRpc.requests.size).toBe(67);
  });

  it("ExternalRpc has 31 procedures", () => {
    expect(ExternalRpc.requests.size).toBe(31);
  });

  it("Bob domain total is 129 procedures", () => {
    const total =
      WorkItemsRpc.requests.size +
      PlanningRpc.requests.size +
      ExternalRpc.requests.size;
    expect(total).toBe(129);
  });
});
