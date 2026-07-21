import { describe, expect, it } from "vitest";

import { WorkItemsRpc } from "../groups/work-items.js";
import { PlanningRpc } from "../groups/planning.js";
import { ExternalRpc } from "../groups/external.js";

// Structural invariants only — intentionally NOT hardcoded procedure counts.
// Absolute-count assertions forced every RPC-adding PR to edit this file,
// serially conflicting the backlog; the checks below catch real defects
// (empty groups, tag collisions) without changing when a procedure is added.
describe("Bob contract groups — structural invariants", () => {
  const groups = { WorkItemsRpc, PlanningRpc, ExternalRpc };

  it("every group defines at least one procedure", () => {
    for (const [name, group] of Object.entries(groups)) {
      expect(group.requests.size, `${name} should define procedures`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate procedure tags across groups", () => {
    const tags = [
      ...WorkItemsRpc.requests.keys(),
      ...PlanningRpc.requests.keys(),
      ...ExternalRpc.requests.keys(),
    ];
    expect(new Set(tags).size).toBe(tags.length);
  });
});
