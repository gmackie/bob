import { emptyView, OFFLINE_AFTER_MS } from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { attentionEntries, bannerFor, bannerText, browseHref, browseModel, drillParams, itemDetail, itemHref, stateTiles } from "./attention-model";
import { must, PENDING, viewOf } from "./test-fixtures";

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
        { itemId: "b-stall", state: "validating", repo: "forgegraph", identifier: "FG-1" },
        { itemId: "b-wait", state: "waiting-input", repo: "forgegraph", identifier: "FG-2", pendingInput: PENDING },
      ],
    },
  ]);

describe("attentionEntries", () => {
  it("lists waiting-for-input first, then review, failed, stalled; never ok items", () => {
    const entries = attentionEntries(fleet());
    expect(entries.map((e) => e.itemId)).toEqual(["a-wait", "b-wait", "a-review", "a-fail", "b-stall"]);
    expect(entries.some((e) => e.itemId === "a-run")).toBe(false);
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
