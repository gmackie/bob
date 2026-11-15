import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyView, reduce, rows, type EdgeView, type ItemSnapshot, type PlanSnapshot, type ReleaseStatus, type TopologyRepo } from "@bob/sdlc-view";
import { ItemDetail } from "./item-detail";
import { PlanDag } from "./plan-dag";
import { bannerFor, breadcrumbs, drillInto, itemFromParams, scopeFromParams, sdlcHref, sdlcPageModel, selectionForItemParam, stateFromParams } from "./sdlc-page-model";

const repo = (repositoryId: string, integrationId = "forgegraph") => ({ environmentId: "hetzner-bob", projectId: "p", repository: { integrationId, repositoryId } });
const issue = (id: string) => ({ integrationId: "kanbanger", workspaceId: "gmacko", teamId: "BOB", projectId: "bob", issueId: id, identifier: `BOB-${id}`, url: `https://tasks.gmac.io/BOB-${id}` });
const plan: PlanSnapshot = {
  planId: "plan-1234567890", resourceVersion: 3, state: "active",
  definition: {
    items: [
      { itemId: "a", issue: issue("1"), target: repo("bob"), completionTarget: "production" },
      { itemId: "b", issue: issue("2"), target: repo("bob"), completionTarget: "execution" },
      { itemId: "c", issue: issue("3"), target: repo("pulse"), completionTarget: "production" },
      { itemId: "d", issue: issue("4"), target: repo("bob", "github"), completionTarget: "production" },
    ],
    dependencies: [
      { upstreamItemId: "a", downstreamItemId: "b", requiredMilestone: "merged" },
      { upstreamItemId: "b", downstreamItemId: "c", requiredMilestone: "execution-succeeded" },
    ],
    concurrencyLimit: 2,
  },
};
const item = (itemId: string, state: ItemSnapshot["state"], extra: Partial<ItemSnapshot> = {}): ItemSnapshot =>
  ({ itemId, planId: plan.planId, resourceVersion: 1, state, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [], ...extra });
const topology: TopologyRepo[] = [{ startupId: "s-bob", startupName: "Bob", repoSlug: "gmackie/bob" }];
const items = [
  item("a", "running", { currentAttemptId: "att-1", achievedMilestones: [], execution: { attemptId: "att-1", target: repo("bob"), thread: { environmentId: "env-1", projectId: "proj-1", threadId: "thr-9", turnId: "turn-2" } } }),
  item("b", "validating"),
  item("c", "pending"),
  item("d", "failed"),
];
const view: EdgeView = reduce(emptyView(), { type: "snapshot", epoch: "e1", seq: 1, plans: [plan], items, topology, coordinatorSeenAt: 1_000 });
const params = (q: string) => new URLSearchParams(q);

describe("sdlc page model", () => {
  it("waits for a snapshot, then says honestly when the coordinator has no plans", () => {
    expect(sdlcPageModel(emptyView(), {}, null).status).toBe("waiting");
    const empty = reduce(emptyView(), { type: "snapshot", epoch: "e1", seq: 1, plans: [], items: [], topology: [], coordinatorSeenAt: null });
    expect(sdlcPageModel(empty, {}, null).status).toBe("empty");
    expect(sdlcPageModel(view, {}, null).status).toBe("ready");
  });

  it("drills Fleet → Project → Repo through the URL, keyed by repoKey and labelled with the repo id", () => {
    const fleet = sdlcPageModel(view, scopeFromParams(params("")), null);
    expect(fleet.groupLevel).toBe("project");
    expect(fleet.groups.map((g) => [g.key, g.label, g.count, g.attention])).toEqual([["s-bob", "Bob", 2, 0], ["unassigned", "Unassigned", 2, 1]]);
    expect(fleet.breadcrumbs).toEqual([{ label: "Fleet" }]);

    const projectScope = drillInto({}, "project", fleet.groups[1]!);
    expect(sdlcHref(projectScope)).toBe("/sdlc?project=unassigned");
    const project = sdlcPageModel(view, scopeFromParams(params("project=unassigned")), null);
    expect(project.groupLevel).toBe("repo");
    // The GitHub "bob" is keyed apart from the ForgeGraph "bob" (which joined to the Bob project).
    expect(project.groups.map((g) => [g.key, g.label])).toEqual([["github:bob", "bob"], ["forgegraph:pulse", "pulse"]]);

    const repoScope = drillInto(projectScope, "repo", project.groups[0]!);
    expect(sdlcHref(repoScope)).toBe("/sdlc?project=unassigned&repo=github%3Abob");
    const leaf = sdlcPageModel(view, scopeFromParams(params("project=unassigned&repo=github%3Abob")), null);
    expect(leaf.groupLevel).toBeNull();
    expect(leaf.scoped.map((r) => r.item.itemId)).toEqual(["d"]);
    expect(leaf.breadcrumbs).toEqual([
      { label: "Fleet", href: "/sdlc" },
      { label: "Unassigned", href: "/sdlc?project=unassigned" },
      { label: "bob" },
    ]);
  });

  it("counts states in scope, filters by the selected state, and lists attention first by severity", () => {
    const model = sdlcPageModel(view, {}, "validating");
    expect(model.counts).toMatchObject({ running: 1, validating: 1, pending: 1, failed: 1 });
    expect(model.listed.map((r) => r.item.itemId)).toEqual(["b"]);
    // validating is moving (the release driver runs it), so only the failed item needs attention.
    expect(model.attention.map((r) => r.item.itemId)).toEqual(["d"]);
  });

  it("selects the item ?item= names, and follows it when it changes", () => {
    expect(itemFromParams(params("item=a"))).toBe("a");
    expect(itemFromParams(params("item="))).toBeNull();
    expect(itemFromParams(params("state=failed"))).toBeNull();
    expect(selectionForItemParam(null, "a")).toBe("a");
    expect(selectionForItemParam("a", "b")).toBe("b"); // a second notification while open
    expect(selectionForItemParam("c", null)).toBe("c"); // the URL dropped ?item=: keep the page's pick
    expect(sdlcPageModel(view, {}, null, { itemId: selectionForItemParam("a", itemFromParams(params("item=b"))), planId: null }).selected?.item.itemId).toBe("b");
  });

  it("keeps the state filter in the URL, through drill-down and breadcrumbs, ignoring unknown states", () => {
    expect(stateFromParams(params("state=validating"))).toBe("validating");
    expect(stateFromParams(params("state=bogus"))).toBeNull();
    expect(stateFromParams(params(""))).toBeNull();
    expect(sdlcHref({}, "failed")).toBe("/sdlc?state=failed");
    expect(sdlcHref({ startupId: "s-bob", repoKey: "forgegraph:bob" }, "running")).toBe("/sdlc?project=s-bob&repo=forgegraph%3Abob&state=running");
    const model = sdlcPageModel(view, { startupId: "s-bob", repoKey: "forgegraph:bob" }, "running");
    expect(model.breadcrumbs.map((b) => b.href)).toEqual(["/sdlc?state=running", "/sdlc?project=s-bob&state=running", undefined]);
  });

  it("shows the selected item and its plan only while the item is in scope", () => {
    const selection = { itemId: "a", planId: plan.planId };
    const inBob = sdlcPageModel(view, { startupId: "s-bob" }, null, selection);
    expect(inBob.selected?.item.itemId).toBe("a");
    expect(inBob.plan?.planId).toBe(plan.planId);
    // Drilling into a project that does not hold item a drops the item; the plan stays
    // because its items c and d are in this project.
    const elsewhere = sdlcPageModel(view, { startupId: "unassigned" }, null, selection);
    expect(elsewhere.selected).toBeNull();
    expect(elsewhere.plan?.planId).toBe(plan.planId);
    // A scope with none of the plan's items drops the plan too.
    const empty = sdlcPageModel(view, { startupId: "unassigned", repoKey: "forgegraph:other" }, null, selection);
    expect(empty).toMatchObject({ selected: null, plan: null });
    expect(sdlcPageModel(view, {}, null, { itemId: "missing", planId: "gone" })).toMatchObject({ selected: null, plan: null });
  });

  it("labels a repo crumb from its key when no row is in view", () => {
    expect(breadcrumbs({ startupId: "x", repoKey: "forgegraph:gone" }, []).map((b) => b.label)).toEqual(["Fleet", "x", "gone"]);
  });

  it("shows a banner for the socket being down, then a silent coordinator, and nothing while the hello is answered", () => {
    expect(bannerFor(view, "connecting", 2_000)).toEqual({ kind: "connecting" });
    expect(bannerFor(view, "reconnecting", 2_000)).toEqual({ kind: "reconnecting" });
    expect(bannerFor(emptyView(), "live", 2_000)).toBeNull();
    expect(bannerFor(view, "live", 2_000)).toBeNull();
    expect(bannerFor(view, "live", 1_000 + 91_000)).toEqual({ kind: "coordinator-offline", since: 1_000 });
  });
});

describe("PlanDag", () => {
  it("lays items out by dependency depth and lists each dependency with its milestone", () => {
    const html = renderToStaticMarkup(<PlanDag plan={plan} items={view.items} onSelect={() => {}} onClose={() => {}} />);
    const layer = (n: number) => html.match(new RegExp(`<ol aria-label="Layer ${n}"[^>]*>(.*?)</ol>`))?.[1] ?? "";
    expect(layer(1)).toContain("BOB-1");
    expect(layer(1)).toContain("BOB-4");
    expect(layer(2)).toContain("BOB-2");
    expect(layer(3)).toContain("BOB-3");
    expect(html).toContain("BOB-2 waits for BOB-1 to reach <span class=\"font-medium\">merged</span>");
    expect(html).toContain("BOB-3 waits for BOB-2 to reach <span class=\"font-medium\">execution-succeeded</span>");
    expect(html).toContain("plan-123");
  });
});

describe("ItemDetail", () => {
  it("renders a coordinator issue url as a link only when it is http(s)", () => {
    const base = rows(view).find((r) => r.item.itemId === "a")!;
    const render = (url: string) => renderToStaticMarkup(<ItemDetail row={{ ...base, issue: { ...base.issue, url } }} onClose={() => {}} onOpenPlan={() => {}} />);
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)"]) {
      const html = render(url);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain(url.slice(0, 8));
      expect(html).toContain("BOB-1");
    }
    expect(render("https://tasks.gmac.io/BOB-1")).toContain('<a href="https://tasks.gmac.io/BOB-1"');
  });

  it("links the issue and shows milestones, the attempt and the T3 thread", () => {
    const row = rows(view).find((r) => r.item.itemId === "a")!;
    const html = renderToStaticMarkup(<ItemDetail row={row} onClose={() => {}} onOpenPlan={() => {}} />);
    expect(html).toContain('href="https://tasks.gmac.io/BOB-1"');
    expect(html).toMatch(/>merged<span class="sr-only">: not yet<\/span>/);
    expect(html).not.toMatch(/<span[^>]*aria-label="merged/);
    expect(html).toContain("att-1");
    expect(html).toContain("env-1 / proj-1 / thr-9 · turn turn-2");
    expect(html).not.toContain('aria-label="Release"');
  });

  it("shows the release: stage, PR link, branch, shas, deployment, auto-merge and a blocked note", () => {
    const base = rows(view).find((r) => r.item.itemId === "a")!;
    const release: ReleaseStatus = {
      attemptId: "att-1", stage: "blocked", autoMerge: true, branch: "bob/BOB-1", headSha: "a".repeat(40), approvedSha: "b".repeat(40), mergeSha: "c".repeat(40),
      pullRequest: { repository: base.target.repository, number: 42, url: "https://git.forgegraf.com/gmackie/bob/pulls/42" },
      appSlug: "bob", deploymentId: "dep-9", note: "push rejected: protected branch", updatedAt: "2026-11-15T00:00:00Z",
    };
    const render = (r: ReleaseStatus) => renderToStaticMarkup(<ItemDetail row={{ ...base, item: { ...base.item, state: "validating", release: r } }} onClose={() => {}} onOpenPlan={() => {}} />);
    const html = render(release);
    expect(html).toContain('data-release-stage="blocked"');
    expect(html).toContain(">Blocked<");
    expect(html).toContain('<a href="https://git.forgegraf.com/gmackie/bob/pulls/42" target="_blank" rel="noreferrer"');
    expect(html).toContain("bob/BOB-1");
    expect(html).toContain(">aaaaaaaa<");
    expect(html).toContain(">bbbbbbbb<");
    expect(html).toContain(">cccccccc<");
    expect(html).toContain("bob · dep-9");
    expect(html).toMatch(/Auto-merge<\/dt><dd>on</);
    expect(html).toMatch(/role="alert"[^>]*>push rejected: protected branch</);
    const quiet = render({ ...release, stage: "deploying", note: "rolling out", pullRequest: { ...release.pullRequest!, url: "javascript:alert(1)" } });
    expect(quiet).not.toContain('role="alert"');
    expect(quiet).toContain("#42");
    expect(quiet).not.toContain("javascript:");
  });
});
