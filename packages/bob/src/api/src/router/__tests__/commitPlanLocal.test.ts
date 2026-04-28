import { describe, expect, it } from "vitest";

/**
 * Unit tests for commitPlanLocal cycle detection logic.
 * The cycle detection algorithm is embedded in commitPlanLocal — these tests
 * exercise the topological sort logic with synthetic graph data.
 */

function detectCycle(
  nodeIds: string[],
  edges: Array<{ draftId: string; dependsOnDraftId: string }>,
): boolean {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjList.set(id, []);
  }
  for (const dep of edges) {
    adjList.get(dep.dependsOnDraftId)?.push(dep.draftId);
    inDegree.set(dep.draftId, (inDegree.get(dep.draftId) ?? 0) + 1);
  }
  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjList.get(node) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }
  return visited < nodeIds.length;
}

describe("commitPlanLocal cycle detection", () => {
  it("detects no cycle in a linear chain", () => {
    const nodes = ["a", "b", "c"];
    const edges = [
      { draftId: "b", dependsOnDraftId: "a" },
      { draftId: "c", dependsOnDraftId: "b" },
    ];
    expect(detectCycle(nodes, edges)).toBe(false);
  });

  it("detects no cycle in a DAG with fan-out", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = [
      { draftId: "b", dependsOnDraftId: "a" },
      { draftId: "c", dependsOnDraftId: "a" },
      { draftId: "d", dependsOnDraftId: "b" },
      { draftId: "d", dependsOnDraftId: "c" },
    ];
    expect(detectCycle(nodes, edges)).toBe(false);
  });

  it("detects cycle in A→B→A", () => {
    const nodes = ["a", "b"];
    const edges = [
      { draftId: "b", dependsOnDraftId: "a" },
      { draftId: "a", dependsOnDraftId: "b" },
    ];
    expect(detectCycle(nodes, edges)).toBe(true);
  });

  it("detects cycle in A→B→C→A", () => {
    const nodes = ["a", "b", "c"];
    const edges = [
      { draftId: "b", dependsOnDraftId: "a" },
      { draftId: "c", dependsOnDraftId: "b" },
      { draftId: "a", dependsOnDraftId: "c" },
    ];
    expect(detectCycle(nodes, edges)).toBe(true);
  });

  it("handles no dependencies (no cycle)", () => {
    const nodes = ["a", "b", "c"];
    const edges: Array<{ draftId: string; dependsOnDraftId: string }> = [];
    expect(detectCycle(nodes, edges)).toBe(false);
  });

  it("handles single node with no edges", () => {
    expect(detectCycle(["a"], [])).toBe(false);
  });

  it("detects cycle even when some nodes are not in the cycle", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = [
      { draftId: "b", dependsOnDraftId: "a" }, // a→b (no cycle)
      { draftId: "d", dependsOnDraftId: "c" }, // c→d (cycle)
      { draftId: "c", dependsOnDraftId: "d" }, // d→c (cycle)
    ];
    expect(detectCycle(nodes, edges)).toBe(true);
  });
});
