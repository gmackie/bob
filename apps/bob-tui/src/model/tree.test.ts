import { describe, expect, it } from "vitest";
import { reduce } from "@bob/sdlc-view";

import { fixtureView, PLAN_ACTIVE, PLAN_DRAFT, PLAN_PAUSED } from "../fixtures";
import {
  breadcrumb,
  childrenOf,
  dependencyTree,
  drillPath,
  focusOf,
  headerCounts,
  inbox,
  keyAtLevel,
  levelOf,
  pathForRow,
  selectionOf,
  upPath,
} from "./tree";

const view = fixtureView();
const bobRepo = "forgegraph:gmackie/bob";

describe("tree levels", () => {
  it("fleet lists projects by size, with attention counts", () => {
    expect(childrenOf(view, {}).map((n) => [n.label, n.count, n.attention])).toEqual([["Bob", 5, 3], ["ForgeGraph", 2, 1]]);
  });

  it("project lists repos keyed by repoKey", () => {
    expect(childrenOf(view, { startupId: "s-bob" }).map((n) => n.key)).toEqual([bobRepo]);
  });

  it("repo lists plans, including a draft plan with no item snapshots", () => {
    const nodes = childrenOf(view, { startupId: "s-bob", repoKey: bobRepo });
    expect(nodes.map((n) => [n.key, n.state])).toEqual([[PLAN_ACTIVE, "active"], [PLAN_DRAFT, "draft"]]);
    expect(nodes[1]!.count).toBe(1);
  });

  it("plan lists items in dependency-layer order; the item level lists the same siblings", () => {
    const path = { startupId: "s-bob", repoKey: bobRepo, planId: PLAN_ACTIVE };
    expect(childrenOf(view, path).map((n) => n.label)).toEqual(["BOB-71", "BOB-72", "BOB-73", "BOB-74"]);
    expect(childrenOf(view, { ...path, itemId: "item-a2" })).toEqual(childrenOf(view, path));
  });

  it("drills down and back up, keeping the key to place the cursor on", () => {
    let path = drillPath({}, childrenOf(view, {})[0]!);
    path = drillPath(path, childrenOf(view, path)[0]!);
    path = drillPath(path, childrenOf(view, path)[0]!);
    path = drillPath(path, childrenOf(view, path)[1]!);
    expect(path).toEqual({ startupId: "s-bob", repoKey: bobRepo, planId: PLAN_ACTIVE, itemId: "item-a2" });
    expect(levelOf(path)).toBe("item");
    expect(breadcrumb(view, path)).toEqual(["Fleet", "Bob", "gmackie/bob", "plan a1c7e5f0", "BOB-72"]);
    expect(keyAtLevel(path)).toBe("item-a2");
    expect(upPath(upPath(upPath(upPath(path))))).toEqual({});
    expect(upPath({})).toEqual({});
  });

  it("a plan evicted by a terminal delta disappears from its repo", () => {
    const cancelled = { ...view.plans[PLAN_DRAFT]!, state: "cancelled" as const, resourceVersion: 9 };
    const next = reduce(view, { type: "delta", seq: 11, plans: [cancelled], items: [], coordinatorSeenAt: null });
    expect(childrenOf(next, { startupId: "s-bob", repoKey: bobRepo }).map((n) => n.key)).toEqual([PLAN_ACTIVE]);
  });
});

describe("focus and selection", () => {
  it("at the repo level the cursor's plan is the focus and the command target", () => {
    const path = { startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph" };
    const node = childrenOf(view, path)[0];
    expect(focusOf(view, path, node)).toMatchObject({ kind: "plan", plan: { planId: PLAN_PAUSED } });
    expect(selectionOf(view, path, node)).toMatchObject({ plan: { planId: PLAN_PAUSED }, item: null });
  });

  it("inside a plan the cursor's item is selected along with the plan", () => {
    const path = { startupId: "s-bob", repoKey: bobRepo, planId: PLAN_ACTIVE };
    const node = childrenOf(view, path)[2];
    expect(focusOf(view, path, node)).toMatchObject({ kind: "plan", cursorItemId: "item-a3" });
    expect(selectionOf(view, path, node)).toMatchObject({ plan: { planId: PLAN_ACTIVE }, item: { itemId: "item-a3" }, itemLabel: "BOB-73" });
  });

  it("at a group level the focus summarizes the cursor's group", () => {
    const focus = focusOf(view, {}, childrenOf(view, {})[1]);
    expect(focus).toMatchObject({ kind: "group", label: "ForgeGraph", plans: 1 });
    if (focus.kind === "group") expect(focus.counts["waiting-input"]).toBe(1);
  });
});

describe("dependency tree", () => {
  it("indents downstream items and back-references a second parent", () => {
    const lines = dependencyTree(view, view.plans[PLAN_ACTIVE]!);
    expect(lines.map((l) => `${"  ".repeat(l.depth)}${l.label}${l.repeat ? " ^" : ""}${l.requires ? ` (${l.requires})` : ""}`)).toEqual([
      "BOB-71",
      "  BOB-72",
      "    BOB-74",
      "  BOB-73 (merged)",
      "    BOB-74 ^",
    ]);
  });

  it("still draws every item once when dependencies form a cycle", () => {
    const plan = view.plans[PLAN_PAUSED]!;
    const cyclic = { ...plan, definition: { ...plan.definition, dependencies: [...plan.definition.dependencies, { upstreamItemId: "item-p2", downstreamItemId: "item-p1", requiredMilestone: "merged" as const }] } };
    const lines = dependencyTree(view, cyclic);
    expect(new Set(lines.filter((l) => !l.repeat).map((l) => l.itemId))).toEqual(new Set(["item-p1", "item-p2"]));
  });
});

describe("inbox and header", () => {
  it("lists attention items worst first and opens them by path", () => {
    const rows = inbox(view);
    expect(rows.map((r) => r.item.state)).toEqual(["validating", "waiting-input", "failed", "execution-unknown"]);
    // item-a1's release is blocked: it needs a human, like the waiting-input item.
    expect(pathForRow(rows[1]!)).toEqual({ startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph", planId: PLAN_PAUSED, itemId: "item-p1" });
  });

  it("counts plans, items and attention", () => {
    expect(headerCounts(view)).toMatchObject({ plans: 3, items: 6, attention: 4 });
  });
});
