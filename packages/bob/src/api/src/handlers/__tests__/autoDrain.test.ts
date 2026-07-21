import { describe, it, expect } from "vitest";

import { pickAcrossProjects } from "../autoDrain-pick";

const item = (id: string, projectId: string | null) => ({ id, projectId });

describe("pickAcrossProjects", () => {
  it("round-robins across projects instead of draining one first", () => {
    const ready = [
      item("a1", "A"),
      item("a2", "A"),
      item("a3", "A"),
      item("b1", "B"),
      item("c1", "C"),
    ];
    // Budget 3 should touch all three projects, not take a1,a2,a3.
    const picked = pickAcrossProjects(ready, 3);
    const projects = new Set(picked.map((p) => p.projectId));
    expect(picked).toHaveLength(3);
    expect(projects).toEqual(new Set(["A", "B", "C"]));
  });

  it("falls back to remaining items when some projects run dry", () => {
    const ready = [item("a1", "A"), item("a2", "A"), item("b1", "B")];
    const picked = pickAcrossProjects(ready, 3);
    expect(picked.map((p) => p.id).sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("never returns more than the budget", () => {
    const ready = Array.from({ length: 50 }, (_, i) =>
      item(`x${i}`, `p${i % 5}`),
    );
    expect(pickAcrossProjects(ready, 4)).toHaveLength(4);
  });

  it("returns nothing for an empty ready list", () => {
    expect(pickAcrossProjects([], 4)).toHaveLength(0);
  });

  it("groups null projectIds together under one bucket", () => {
    const ready = [item("n1", null), item("n2", null), item("a1", "A")];
    const picked = pickAcrossProjects(ready, 2);
    // First pick from bucket "none", second from "A" (round-robin)
    expect(picked.map((p) => p.projectId)).toEqual([null, "A"]);
  });
});
