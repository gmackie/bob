import { describe, expect, it } from "vitest";
import type { EdgeView, TrackedIssue } from "@bob/sdlc-view";

import { boardRowSummary, projectBoard } from "../src/board";
import { floorScene, floorSummary } from "../src/floor";
import { snapshot, viewOf } from "./fixtures";

const H = 3_600_000;
const NOW = 1_000 * 24 * H;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function issue(over: Partial<TrackedIssue> & { key: string; project?: TrackedIssue["project"] }): TrackedIssue {
  return {
    id: uuid(), title: `Title of ${over.key}`, url: `https://tasks.gmac.io/i/${over.key}`, state: { name: "In Progress", type: "started" },
    project: { id: "p-forge", name: "ForgeGraph" }, team: "GMA", updatedAt: NOW - H, pr: null, dispatchable: false, version: 1, ...over,
  };
}
const pr = (state: "open" | "merged" | "closed", checks: "pending" | "success" | "failure" | null) =>
  ({ repo: "gmackie/forgegraph", number: 7, url: "https://git.forgegraf.com/gmackie/forgegraph/pulls/7", state, checks, headSha: null, checkedAt: NOW });
const withIssues = (view: EdgeView, issues: TrackedIssue[]): EdgeView => ({ ...view, issues: Object.fromEntries(issues.map((i) => [i.id, i])) });

const forge = [
  issue({ key: "FORGE-1", state: { name: "Todo", type: "unstarted" } }),
  issue({ key: "FORGE-2" }),
  issue({ key: "FORGE-3", pr: pr("open", "pending") }),
  issue({ key: "FORGE-4", state: { name: "In Review", type: "started" }, pr: pr("open", "success") }),
  issue({ key: "FORGE-5", state: { name: "In Review", type: "started" }, pr: pr("merged", "success"), updatedAt: NOW - 9 * 24 * H }),
  issue({ key: "FORGE-6", state: { name: "In Review", type: "started" }, updatedAt: NOW - 30 * 24 * H }),
  issue({ key: "FORGE-7", state: { name: "Backlog", type: "backlog" } }),
  issue({ key: "FORGE-8", state: { name: "Done", type: "completed" } }),
  issue({ key: "FORGE-9", pr: pr("open", "failure") }),
];
const edu = [
  issue({ key: "SCHO-1", project: { id: "p-edu", name: "EducateOS" } }),
  issue({ key: "SCHO-2", project: { id: "p-edu", name: "EducateOS" } }),
];
const quiet = [issue({ key: "QUIET-1", project: { id: "p-quiet", name: "Quiet" }, state: { name: "Backlog", type: "backlog" } })];

describe("projectBoard (BOB-99)", () => {
  const view = withIssues(viewOf(snapshot([])), [...forge, ...edu, ...quiet]);
  const board = projectBoard(view, NOW);

  it("counts each project's open work by lane, with stale, failed and backlog", () => {
    const row = board.rows.find((r) => r.name === "ForgeGraph")!;
    expect(row.lanes).toEqual({ queue: 1, working: 1, ci: 2, review: 2, deploy: 1 });
    expect(row).toMatchObject({ stale: 2, failed: 1, backlog: 1, active: 6, kanbanger: true });
    expect(boardRowSummary(row)).toBe("ForgeGraph: 1 to do, 1 in progress, 2 in CI, 2 in review, 1 deploying; 2 stale, 1 failed, 1 in backlog");
  });

  it("sorts stale first, then active work, then name; totals the header", () => {
    expect(board.rows.map((r) => r.name)).toEqual(["ForgeGraph", "EducateOS", "Quiet"]);
    expect(board).toMatchObject({ started: 8, stale: 2, failed: 1 });
  });

  it("puts coordinator items in their issue's project and draws each issue once", () => {
    const items = viewOf(snapshot([{ itemId: "x", state: "running", identifier: "FORGE-2" }]));
    // The fixture plan's issue lives in project "p"; give that project a tracked issue so the item joins it.
    const joined = withIssues(items, [issue({ key: "P-1", project: { id: "p", name: "Bob" } })]);
    const bob = projectBoard(joined, NOW).rows.find((r) => r.name === "Bob")!;
    expect(bob.lanes.working).toBe(2);
    const orphan = projectBoard(items, NOW).rows;
    expect(orphan).toEqual([expect.objectContaining({ projectId: "repo:bob", kanbanger: false, name: "bob" })]);
  });
});

describe("floor with tracked issues (BOB-99)", () => {
  const view = withIssues(viewOf(snapshot([{ itemId: "i1", state: "validating" }])), [...forge, ...edu]);

  it("places issues by stage beside items, keeps backlog off the belt", () => {
    const scene = floorScene(view, { width: 1200, height: 900 }, { now: NOW, projectId: "p-forge" });
    const at = (key: string) => scene.parcels.find((p) => p.label === key);
    expect(at("FORGE-1")?.stationId).toBe("queue");
    expect(at("FORGE-2")?.stationId).toBe("agents");
    expect(at("FORGE-3")?.stationId).toBe("ci");
    expect(at("FORGE-4")?.stationId).toBe("review");
    expect(at("FORGE-5")).toMatchObject({ stationId: "deploy", attention: "stalled", marker: "?", age: "9d" });
    expect(at("FORGE-8")?.stationId).toBe("shipped");
    expect(at("FORGE-9")).toMatchObject({ stationId: "ci", attention: "failed", tone: "ci" });
    expect(at("FORGE-7")).toBeUndefined();
    expect(scene.backlog).toBe(1);
    expect(at("FORGE-2")).toMatchObject({ kind: "issue", issueId: at("FORGE-2")!.itemId, state: null, stateLabel: "In Progress", sublabel: "Title of FORG…" });
  });

  it("scopes to one project: its issues and only the items whose plan issue is in it", () => {
    const scene = floorScene(view, { width: 1200, height: 900 }, { now: NOW, projectId: "p-edu" });
    expect(scene.parcels.map((p) => p.label).sort()).toEqual(["SCHO-1", "SCHO-2"]);
    const all = floorScene(view, { width: 1200, height: 900 }, { now: NOW });
    expect(all.parcels.some((p) => p.kind === "item")).toBe(true);
    expect(all.backlog).toBe(1);
  });

  it("does not draw an issue a coordinator item already draws", () => {
    const items = viewOf(snapshot([{ itemId: "i9", state: "running", identifier: "FORGE-2" }]));
    const twin = issue({ key: "FORGE-2", project: { id: "p", name: "Bob" } });
    // The fixture item's plan issue id is `iss-i9`; a tracked issue with that id is the same work.
    const same = { ...twin, id: "iss-i9" };
    const scene = floorScene(withIssues(items, [same, twin]), { width: 1200, height: 900 }, { now: NOW });
    expect(scene.parcels.filter((p) => p.label === "FORGE-2").map((p) => p.kind).sort()).toEqual(["issue", "item"]);
    expect(scene.parcels.filter((p) => p.itemId === "iss-i9")).toEqual([]);
  });

  it("reads issue parcels as text by key", () => {
    const lines = floorSummary(floorScene(view, { width: 1200, height: 900 }, { now: NOW, projectId: "p-edu" }));
    expect(lines).toEqual(["Agents: SCHO-1, SCHO-2"]);
  });

  it("leaves a view without issues exactly as before", () => {
    const plain = viewOf(snapshot([{ itemId: "i1", state: "validating" }]));
    const scene = floorScene(plain, { width: 390, height: 700 });
    expect(scene.backlog).toBe(0);
    expect(scene.parcels.map((p) => p.kind)).toEqual(["item"]);
  });
});
