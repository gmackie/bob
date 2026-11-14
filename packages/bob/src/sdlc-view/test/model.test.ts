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
  rows,
  type ItemSnapshot,
  type PlanSnapshot,
} from "../src/model";

const target = (repositoryId: string, integrationId = "forgegraph") => ({ environmentId: "hetzner-bob", projectId: "p", repository: { integrationId, repositoryId } });
const issue = { integrationId: "kanbanger", workspaceId: "gmacko", teamId: "GMA", projectId: "bob", issueId: "i" };
const plan = (planId: string, ids: string[], deps: Array<[string, string]> = [], repo = "bob"): PlanSnapshot => ({
  planId, resourceVersion: 1, state: "active",
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
  it("never moves seq backwards on a late delta", () => {
    let view = reduce(emptyView(), { type: "snapshot", seq: 7, plans: [], items: [], topology, coordinatorSeenAt: 10 });
    view = reduce(view, { type: "delta", seq: 6, plans: [], items: [], coordinatorSeenAt: 20 });
    expect(view.seq).toBe(7);
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
  it("prefers an exact slug over a last-segment match", () => {
    const two = [{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }, { startupId: "s2", startupName: "Fork", repoSlug: "fork/bob" }];
    expect(projectFor(two, { integrationId: "forgegraph", repositoryId: "fork/bob" }).startupId).toBe("s2");
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
  it("groups by repository, keyed by repositoryId", () => {
    expect(groupRows(rows(view), "repo").map((g) => [g.key, g.count])).toEqual([["bob", 2], ["other", 1]]);
  });
  it("drops items whose plan the view doesn't have", () => {
    const orphan = reduce(view, { type: "delta", seq: 2, plans: [], items: [item("z", "missing", "failed")], coordinatorSeenAt: 1 });
    expect(rows(orphan).map((r) => r.item.itemId).sort()).toEqual(["a", "b", "c"]);
  });
  it("scopes rows to a project and a repository", () => {
    expect(rows(view).filter((r) => inScope(r, { startupId: "s1" })).map((r) => r.item.itemId).sort()).toEqual(["a", "b"]);
    expect(rows(view).filter((r) => inScope(r, { startupId: "unassigned", repositoryId: "other" })).map((r) => r.item.itemId)).toEqual(["c"]);
    expect(rows(view).filter((r) => inScope(r, {}))).toHaveLength(3);
  });
  it("lists rows that need attention, human first", () => {
    const mixed = reduce(emptyView(), { type: "snapshot", seq: 1, topology, coordinatorSeenAt: 0,
      plans: [plan("p", ["ok", "unknown", "failed", "input"])],
      items: [item("ok", "p", "running"), item("unknown", "p", "execution-unknown"), item("failed", "p", "failed"), item("input", "p", "waiting-input")] });
    expect(attentionRows(rows(mixed)).map((r) => [r.item.itemId, r.attention])).toEqual([
      ["input", "needs_human"], ["failed", "failed"], ["unknown", "stalled"],
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
});

describe("isOffline", () => {
  it("is offline when the coordinator hasn't been heard from for 90 s", () => {
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: null }, 0)).toBe(true);
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: 1_000 }, 60_000)).toBe(false);
    expect(isOffline({ ...emptyView(), coordinatorSeenAt: 1_000 }, 92_000)).toBe(true);
  });
});
