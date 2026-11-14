import { describe, expect, it } from "vitest";
import {
  attentionRows,
  countsByState,
  emptyView,
  groupRows,
  inScope,
  isOffline,
  planLayers,
  projectFor,
  reduce,
  repoKey,
  rows,
  type ItemSnapshot,
  type PlanSnapshot,
} from "../src/model";

const target = (repositoryId: string, integrationId = "forgegraph") => ({ environmentId: "hetzner-bob", projectId: "p", repository: { integrationId, repositoryId } });
const issue = { integrationId: "kanbanger", workspaceId: "gmacko", teamId: "GMA", projectId: "bob", issueId: "i" };
const plan = (planId: string, ids: string[], deps: Array<[string, string]> = [], repo = "bob", state: PlanSnapshot["state"] = "active", resourceVersion = 1): PlanSnapshot => ({
  planId, resourceVersion, state,
  definition: { items: ids.map((itemId) => ({ itemId, issue, target: target(repo), completionTarget: "production" })),
    dependencies: deps.map(([u, d]) => ({ upstreamItemId: u, downstreamItemId: d, requiredMilestone: "merged" as const })), concurrencyLimit: 2 },
});
const item = (itemId: string, planId: string, state: ItemSnapshot["state"], resourceVersion = 1): ItemSnapshot =>
  ({ itemId, planId, resourceVersion, state, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] });
const topology = [{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }];

describe("reduce", () => {
  it("replaces everything on a snapshot and keeps only newer versions on a delta", () => {
    let view = reduce(emptyView(), { type: "snapshot", seq: 1, plans: [plan("p1", ["a"])], items: [item("a", "p1", "ready", 2)], topology, coordinatorSeenAt: 10 });
    view = reduce(view, { type: "delta", seq: 2, plans: [], items: [item("a", "p1", "pending", 1)], coordinatorSeenAt: 20 });
    expect(view.items.a?.state).toBe("ready");
    view = reduce(view, { type: "delta", seq: 3, plans: [], items: [item("a", "p1", "running", 3)], coordinatorSeenAt: 30 });
    expect(view.items.a?.state).toBe("running");
    expect(view.seq).toBe(3);
    view = reduce(view, { type: "snapshot", seq: 4, plans: [], items: [], topology: [], coordinatorSeenAt: 40 });
    expect(view.items).toEqual({});
  });
  it("keeps topology across deltas and only touches liveness on a status message", () => {
    let view = reduce(emptyView(), { type: "snapshot", seq: 5, plans: [plan("p1", ["a"])], items: [item("a", "p1", "ready")], topology, coordinatorSeenAt: 10 });
    view = reduce(view, { type: "delta", seq: 6, plans: [], items: [], coordinatorSeenAt: 20 });
    expect(view.topology).toEqual(topology);
    const status = reduce(view, { type: "status", coordinatorSeenAt: 99 });
    expect(status).toEqual({ ...view, coordinatorSeenAt: 99 });
  });
  it("drops a late delta's contents but still records liveness", () => {
    const view = reduce(emptyView(), { type: "snapshot", seq: 7, plans: [], items: [], topology, coordinatorSeenAt: 10 });
    for (const seq of [6, 7]) {
      const late = reduce(view, { type: "delta", seq, plans: [plan("gone", ["g"])], items: [item("g", "gone", "running")], coordinatorSeenAt: 20 });
      expect(late).toEqual({ ...view, coordinatorSeenAt: 20 });
    }
    const older = reduce(view, { type: "delta", seq: 6, plans: [plan("gone", ["g"])], items: [], coordinatorSeenAt: 5 });
    expect(older).toEqual(view);
  });
  it("only moves coordinatorSeenAt forward on a status message", () => {
    const view = reduce(emptyView(), { type: "snapshot", seq: 1, plans: [], items: [], topology, coordinatorSeenAt: 50 });
    expect(reduce(view, { type: "status", coordinatorSeenAt: 40 }).coordinatorSeenAt).toBe(50);
    expect(reduce(view, { type: "status", coordinatorSeenAt: null }).coordinatorSeenAt).toBe(50);
    expect(reduce(view, { type: "status", coordinatorSeenAt: 60 }).coordinatorSeenAt).toBe(60);
    expect(reduce(emptyView(), { type: "status", coordinatorSeenAt: null }).coordinatorSeenAt).toBeNull();
  });
  it("always applies a snapshot, resetting seq", () => {
    let view = reduce(emptyView(), { type: "snapshot", seq: 9, plans: [], items: [], topology, coordinatorSeenAt: 10 });
    view = reduce(view, { type: "snapshot", seq: 2, plans: [plan("p", ["a"])], items: [item("a", "p", "ready")], topology, coordinatorSeenAt: 11 });
    expect(view.seq).toBe(2);
    expect(Object.keys(view.plans)).toEqual(["p"]);
  });
  it("evicts a plan and its items when a delta carries it terminal", () => {
    const start = reduce(emptyView(), { type: "snapshot", seq: 1, topology, coordinatorSeenAt: 0,
      plans: [plan("done", ["a", "b"]), plan("live", ["c", "d"])],
      items: [item("a", "done", "completed"), item("b", "done", "validating"), item("c", "live", "completed"), item("d", "live", "running")] });
    for (const state of ["completed", "cancelled"] as const) {
      const view = reduce(start, { type: "delta", seq: 2, coordinatorSeenAt: 1,
        plans: [plan("done", ["a", "b"], [], "bob", state, 2)], items: [item("b", "done", "completed", 2)] });
      expect(Object.keys(view.plans)).toEqual(["live"]);
      // A completed item inside a live plan stays.
      expect(Object.keys(view.items).sort()).toEqual(["c", "d"]);
    }
  });
  it("keeps terminal plans out of a snapshot too", () => {
    const view = reduce(emptyView(), { type: "snapshot", seq: 1, topology, coordinatorSeenAt: 0,
      plans: [plan("done", ["a"], [], "bob", "cancelled"), plan("live", ["b"], [], "bob", "cancelling")],
      items: [item("a", "done", "cancelled"), item("b", "live", "running")] });
    expect(Object.keys(view.plans)).toEqual(["live"]);
    expect(Object.keys(view.items)).toEqual(["b"]);
  });
  it("applies a delta after a seq gap but flags the view for resync until a snapshot", () => {
    let view = reduce(emptyView(), { type: "snapshot", seq: 1, plans: [plan("p", ["a"])], items: [item("a", "p", "ready")], topology, coordinatorSeenAt: 0 });
    expect(view.needsResync).toBe(false);
    view = reduce(view, { type: "delta", seq: 2, plans: [], items: [], coordinatorSeenAt: 1 });
    expect(view.needsResync).toBe(false);
    view = reduce(view, { type: "delta", seq: 4, plans: [], items: [item("a", "p", "running", 2)], coordinatorSeenAt: 2 });
    expect(view.needsResync).toBe(true);
    expect(view.items.a?.state).toBe("running");
    expect(view.seq).toBe(4);
    view = reduce(view, { type: "delta", seq: 5, plans: [], items: [], coordinatorSeenAt: 3 });
    expect(view.needsResync).toBe(true);
    view = reduce(view, { type: "snapshot", seq: 6, plans: [], items: [], topology, coordinatorSeenAt: 4 });
    expect(view.needsResync).toBe(false);
  });
});

describe("projectFor", () => {
  it("matches a ForgeGraph repository by full slug or last segment", () => {
    expect(projectFor(topology, { integrationId: "forgegraph", repositoryId: "bob" }).startupId).toBe("s1");
    expect(projectFor(topology, { integrationId: "forgegraph", repositoryId: "gmackie/bob" }).startupId).toBe("s1");
  });
  it("puts anything else under Unassigned", () => {
    expect(projectFor(topology, { integrationId: "github", repositoryId: "bob" }).startupId).toBe("unassigned");
    expect(projectFor(topology, { integrationId: "forgegraph", repositoryId: "other" }).startupId).toBe("unassigned");
  });
  it("prefers an exact slug, and refuses an ambiguous last segment", () => {
    const two = [{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }, { startupId: "s2", startupName: "Fork", repoSlug: "fork/bob" }];
    expect(projectFor(two, { integrationId: "forgegraph", repositoryId: "fork/bob" }).startupId).toBe("s2");
    expect(projectFor(two, { integrationId: "forgegraph", repositoryId: "gmackie/bob" }).startupId).toBe("s1");
    expect(projectFor(two, { integrationId: "forgegraph", repositoryId: "bob" }).startupId).toBe("unassigned");
  });
});

describe("aggregations", () => {
  const view = reduce(emptyView(), { type: "snapshot", seq: 1, topology, coordinatorSeenAt: 0,
    plans: [plan("p1", ["a", "b"]), plan("p2", ["c"], [], "other")],
    items: [item("a", "p1", "running"), item("b", "p1", "waiting-input"), item("c", "p2", "running")] });
  it("counts items per state, with zeros for empty states", () => {
    const counts = countsByState(rows(view));
    expect(counts.running).toBe(2); expect(counts["waiting-input"]).toBe(1); expect(counts.completed).toBe(0);
  });
  it("groups by project with attention counts", () => {
    const groups = groupRows(rows(view), "project");
    expect(groups.map((g) => [g.label, g.count, g.attention])).toEqual([["Bob", 2, 1], ["Unassigned", 1, 0]]);
  });
  it("groups by repository, keyed by integration and repository", () => {
    expect(repoKey({ integrationId: "forgegraph", repositoryId: "bob" })).toBe("forgegraph:bob");
    expect(groupRows(rows(view), "repo").map((g) => [g.key, g.label, g.count])).toEqual([["forgegraph:bob", "bob", 2], ["forgegraph:other", "other", 1]]);
  });
  it("keeps same-named repositories from different integrations apart", () => {
    const mixed = reduce(emptyView(), { type: "snapshot", seq: 1, topology: [], coordinatorSeenAt: 0,
      plans: [plan("p1", ["a"]), { ...plan("p2", ["b"]), definition: { ...plan("p2", ["b"]).definition, items: [{ itemId: "b", issue, target: target("bob", "github"), completionTarget: "production" }] } }],
      items: [item("a", "p1", "running"), item("b", "p2", "running")] });
    const groups = groupRows(rows(mixed), "repo");
    expect(groups.map((g) => [g.key, g.label])).toEqual([["forgegraph:bob", "bob"], ["github:bob", "bob"]]);
    expect(rows(mixed).filter((r) => inScope(r, { repoKey: "github:bob" })).map((r) => r.item.itemId)).toEqual(["b"]);
  });
  it("drops items whose plan the view doesn't have", () => {
    const orphan = reduce(view, { type: "delta", seq: 2, plans: [], items: [item("z", "missing", "failed")], coordinatorSeenAt: 1 });
    expect(rows(orphan).map((r) => r.item.itemId).sort()).toEqual(["a", "b", "c"]);
  });
  it("scopes rows to a project and a repository", () => {
    expect(rows(view).filter((r) => inScope(r, { startupId: "s1" })).map((r) => r.item.itemId).sort()).toEqual(["a", "b"]);
    expect(rows(view).filter((r) => inScope(r, { startupId: "unassigned", repoKey: "forgegraph:other" })).map((r) => r.item.itemId)).toEqual(["c"]);
    expect(rows(view).filter((r) => inScope(r, {}))).toHaveLength(3);
  });
  it("lists rows that need attention, human first (validating counts as stalled)", () => {
    const mixed = reduce(emptyView(), { type: "snapshot", seq: 1, topology, coordinatorSeenAt: 0,
      plans: [plan("p", ["ok", "unknown", "failed", "input", "validating"])],
      items: [item("ok", "p", "running"), item("unknown", "p", "execution-unknown"), item("failed", "p", "failed"), item("input", "p", "waiting-input"), item("validating", "p", "validating")] });
    expect(attentionRows(rows(mixed)).map((r) => [r.item.itemId, r.attention])).toEqual([
      ["input", "needs_human"], ["failed", "failed"], ["unknown", "stalled"], ["validating", "stalled"],
    ]);
  });
});

describe("planLayers", () => {
  it("layers a diamond by longest dependency path", () => {
    const diamond = plan("p", ["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]);
    expect(planLayers(diamond)).toEqual([["a"], ["b", "c"], ["d"]]);
  });
  it("places an item by its longest path, not its shortest", () => {
    const skew = plan("p", ["a", "b", "c"], [["a", "c"], ["a", "b"], ["b", "c"]]);
    expect(planLayers(skew)).toEqual([["a"], ["b"], ["c"]]);
  });
  it("ignores dependencies on unknown items", () => {
    const ghost = plan("p", ["a", "b"], [["a", "b"], ["ghost", "b"], ["a", "ghost"], ["ghost", "a"]]);
    expect(planLayers(ghost)).toEqual([["a"], ["b"]]);
  });
  it("terminates on a cycle and places every known item exactly once, with no empty layers", () => {
    const cyclic = plan("p", ["a", "b", "c"], [["a", "b"], ["b", "a"], ["b", "c"]]);
    const layers = planLayers(cyclic);
    expect(layers.flat().sort()).toEqual(["a", "b", "c"]);
    // Array.from visits holes (every() would skip them).
    expect(Array.from(layers, (layer) => layer?.length ?? 0).every((n) => n > 0)).toBe(true);
  });
});

describe("isOffline", () => {
  it("is offline when the coordinator hasn't been heard from for 90 s", () => {
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: null }, 0)).toBe(true);
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: 1_000 }, 60_000)).toBe(false);
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: 1_000 }, 92_000)).toBe(true);
  });
});
