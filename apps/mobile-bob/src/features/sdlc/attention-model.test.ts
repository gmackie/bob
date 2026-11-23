import { emptyView, OFFLINE_AFTER_MS } from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { attentionEntries, bannerFor, bannerText, browseHref, browseModel, drillParams, itemDetail, itemHref, releaseReason, stateTiles } from "./attention-model";
import type { ItemState, ReleaseStatus } from "@bob/sdlc-view";
import { item, must, PENDING, viewOf } from "./test-fixtures";

const SHA = "a".repeat(40);
const release = (stage: ReleaseStatus["stage"], extra: Partial<ReleaseStatus> = {}): ReleaseStatus =>
  ({ attemptId: "att-s", stage, autoMerge: false, updatedAt: "2026-11-15T00:00:00Z", ...extra });

const fleet = () =>
  viewOf([
    {
      planId: "plan-aaaaaaaa1",
      items: [
        { itemId: "a-review", state: "review", identifier: "BOB-2" },
        { itemId: "a-fail", state: "failed", identifier: "BOB-1", attemptId: "att-f" },
        { itemId: "a-wait", state: "waiting-input", identifier: "BOB-9", pendingInput: PENDING, attemptId: "att-1" },
        { itemId: "a-run", state: "running", identifier: "BOB-3" },
      ],
    },
    {
      planId: "plan-bbbbbbbb2",
      items: [
        { itemId: "b-stall", state: "validating", repo: "forgegraph", identifier: "FG-1", release: release("blocked", { headSha: SHA, note: "push rejected" }) },
        { itemId: "b-ci", state: "validating", repo: "forgegraph", identifier: "FG-3", release: release("checks-running", { headSha: SHA }) },
        { itemId: "b-wait", state: "waiting-input", repo: "forgegraph", identifier: "FG-2", pendingInput: PENDING },
      ],
    },
  ]);

describe("attentionEntries", () => {
  it("lists waiting-for-input first, then review and blocked releases, failed; never ok items", () => {
    const entries = attentionEntries(fleet());
    expect(entries.map((e) => e.itemId)).toEqual(["a-wait", "b-wait", "a-review", "b-stall", "a-fail"]);
    expect(entries.some((e) => e.itemId === "a-run")).toBe(false);
    expect(entries.some((e) => e.itemId === "b-ci")).toBe(false); // validating with CI running is moving
    expect(entries.find((e) => e.itemId === "b-stall")).toMatchObject({ attention: "needs_human", releaseReason: "push rejected" });
  });

  it("treats blocked and checks-failed releases, and a review-ready PR without auto-merge, as needing attention", () => {
    const one = (state: ItemState, r: ReleaseStatus) =>
      attentionEntries(viewOf([{ planId: "plan-c", items: [{ itemId: "x", state, release: r }] }]));
    expect(one("deploying", release("blocked"))[0]).toMatchObject({ attention: "needs_human", releaseReason: "Release blocked" });
    expect(one("failed", release("checks-failed", { note: "test failed" }))[0]).toMatchObject({ attention: "failed", releaseReason: "test failed" });
    const pr = { repository: { integrationId: "forgegraph", repositoryId: "bob" }, number: 7 };
    expect(one("review", release("review-ready", { pullRequest: pr }))[0]).toMatchObject({ attention: "needs_human", releaseReason: "PR #7 is ready to merge" });
    expect(one("review", release("review-ready", { pullRequest: pr, autoMerge: true }))).toEqual([]);
    expect(one("deploying", release("deploying"))).toEqual([]);
    expect(releaseReason(item("p", { itemId: "y", state: "running" }))).toBeNull();
  });

  it("carries the project, repo and plan, and the first pending question", () => {
    const [first] = attentionEntries(fleet());
    expect(first).toMatchObject({ title: "BOB-9", projectName: "Bob", context: "bob · plan plan-aaa", question: "Which database?" });
    expect(attentionEntries(fleet()).find((e) => e.itemId === "a-review")?.question).toBeNull();
  });

  it("is empty before the first snapshot", () => {
    expect(attentionEntries(emptyView())).toEqual([]);
  });
});

describe("stateTiles", () => {
  it("has one tile per state in reading order with counts, marking the selected one", () => {
    const model = browseModel(fleet(), { state: "waiting-input" });
    const tiles = must(model.tiles);
    expect(tiles).toHaveLength(13);
    expect(tiles[0]?.state).toBe("pending");
    expect(tiles.find((t) => t.state === "waiting-input")).toMatchObject({ count: 2, selected: true, attention: "needs_human" });
    expect(tiles.filter((t) => t.selected)).toHaveLength(1);
    expect(stateTiles([]).every((t) => t.count === 0)).toBe(true);
  });
});

describe("browseModel", () => {
  it("L1 fleet: tiles and project groups, no items until a state is chosen", () => {
    const m = browseModel(fleet(), {});
    expect(m.level).toBe("fleet");
    expect(m.groups?.level).toBe("project");
    expect(m.groups?.items.map((g) => g.label)).toEqual(["Bob", "ForgeGraph"]);
    expect(m.items).toBeNull();
    expect(m.crumbs).toEqual([{ label: "Fleet", href: null }]);
  });

  it("a state tile filters the scope to a list", () => {
    const m = browseModel(fleet(), { state: "waiting-input" });
    expect(m.items?.map((i) => i.itemId).sort()).toEqual(["a-wait", "b-wait"]);
  });

  it("L2 project → repo groups; L3 repo → plans; L4 plan → list-first with plan actions", () => {
    const fleetModel = browseModel(fleet(), {});
    const bob = must(fleetModel.groups?.items.find((g) => g.label === "Bob"));
    const projectParams = drillParams({}, "project", bob);
    const project = browseModel(fleet(), projectParams);
    expect(project.level).toBe("project");
    expect(project.groups?.level).toBe("repo");
    const repoParams = drillParams(projectParams, "repo", must(project.groups?.items[0]));
    expect(repoParams).toEqual({ project: "s-bob", repo: "forgegraph:bob" });
    const repo = browseModel(fleet(), repoParams);
    expect(repo.level).toBe("repo");
    expect(repo.plans?.map((p) => p.planId)).toEqual(["plan-aaaaaaaa1"]);
    expect(repo.crumbs.map((c) => c.label)).toEqual(["Fleet", "Bob", "bob"]);
    const planModel = browseModel(fleet(), { ...repoParams, plan: "plan-aaaaaaaa1" });
    expect(planModel.level).toBe("plan");
    expect(planModel.tiles).toBeNull();
    // Attention first, then the rest.
    expect(planModel.items?.map((i) => i.itemId)).toEqual(["a-wait", "a-review", "a-fail", "a-run"]);
    expect(planModel.planActions.map((a) => a.label)).toEqual(["Pause plan", "Cancel plan"]);
    expect(planModel.crumbs.at(-1)).toEqual({ label: "Plan plan-aaa", href: null });
  });

  it("reports waiting before a snapshot and empty for a snapshot with nothing", () => {
    expect(browseModel(emptyView(), {}).status).toBe("waiting");
    expect(browseModel(viewOf([]), {}).status).toBe("empty");
  });
});

describe("hrefs", () => {
  it("encodes browse params and item ids", () => {
    expect(browseHref({})).toBe("/attention/browse");
    expect(browseHref({ project: "s-bob", repo: "forgegraph:bob" })).toBe("/attention/browse?project=s-bob&repo=forgegraph%3Abob");
    expect(itemHref("a/b")).toBe("/attention/a%2Fb");
  });
});

describe("itemDetail", () => {
  it("has the state, milestones, thread ids, and item and plan actions", () => {
    const d = must(itemDetail(fleet(), "a-fail"));
    expect(d.stateLabel).toBe("Failed");
    expect(d.milestones.map((m) => m.key)).toEqual(["execution-succeeded", "review-ready", "merged", "production-verified"]);
    expect(d.thread).toMatchObject({ threadId: "th-a-fail", attemptId: "att-f" });
    expect(d.actions.map((a) => a.label)).toEqual(["Retry"]);
    expect(d.planActions.length).toBeGreaterThan(0);
    expect(d.planHref).toBe("/attention/browse?project=s-bob&repo=forgegraph%3Abob&plan=plan-aaaaaaaa1");
    expect(itemDetail(fleet(), "nope")).toBeNull();
    expect(d.release).toBeNull();
  });

  it("shows the release and offers its actions: retry publish when blocked, a typed rollback once deployed", () => {
    const blocked = must(itemDetail(fleet(), "b-stall"));
    expect(blocked.attention).toBe("needs_human");
    expect(blocked.release).toMatchObject({ stage: "blocked", label: "Blocked", alarm: true, note: "push rejected", head: "aaaaaaaa", autoMerge: false });
    expect(blocked.actions.map((a) => [a.label, a.tier])).toEqual([["Retry publish", 2], ["Cancel item", 2]]);
    const deployed = viewOf([{ planId: "plan-d", items: [{ itemId: "d", state: "completed", repo: "bob", release: release("production-verified", {
      deploymentId: "dep-9", appSlug: "bob", pullRequest: { repository: { integrationId: "forgegraph", repositoryId: "bob" }, number: 4, url: "javascript:alert(1)" },
    }) }] }]);
    const d = must(itemDetail(deployed, "d"));
    expect(d.release).toMatchObject({ alarm: false, deployment: "bob · dep-9", pullRequest: { number: 4, href: null } });
    // No execution target here: the repository to type comes from the plan definition.
    expect(d.actions).toEqual([expect.objectContaining({ label: "Roll back", tier: 3, expected: "bob", destructive: true })]);
  });
});

describe("bannerFor", () => {
  it("shows connecting/reconnecting, auth failure, and a stale coordinator", () => {
    const view = fleet();
    expect(bannerFor(view, "reconnecting", 0)).toEqual({ kind: "reconnecting" });
    expect(bannerFor(view, "auth-failed", 0, "nope")).toEqual({ kind: "auth-failed", message: "nope" });
    expect(bannerFor(view, "live", 1_000)).toBeNull();
    const stale = bannerFor(view, "live", 1_000 + OFFLINE_AFTER_MS + 1);
    expect(stale).toEqual({ kind: "coordinator-offline", since: 1_000 });
    expect(bannerText(must(stale), 1_000 + 5 * 60_000)).toContain("5 min ago");
    expect(bannerFor(emptyView(), "live", 0)).toBeNull();
  });
});
