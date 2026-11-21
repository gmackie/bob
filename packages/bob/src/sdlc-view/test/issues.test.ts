import { describe, expect, it } from "vitest";

import { issueCommands, parseCommandInput, tierOf } from "../src/commands";
import {
  ISSUE_STALE_AFTER_MS,
  issueAttention,
  issueStation,
  issueTargetOf,
  MAX_ISSUES_PER_BATCH,
  parseIssueBatch,
  parseTrackedIssue,
  TITLE_MAX,
  type TrackedIssue,
  type TrackedPr,
} from "../src/issues";
import { emptyView, reduce } from "../src/model";

const UUID = "6599c7ad-a18d-4670-a462-ea815e170356";
const issue = (over: Partial<TrackedIssue> = {}): TrackedIssue => ({
  id: UUID, key: "BOB-101", title: "Readable floor", url: "https://tasks.gmac.io/gmacko/issue/BOB-101",
  state: { name: "In Progress", type: "started" }, project: { id: "p1", name: "Bob" }, team: "GMA",
  updatedAt: 1_000, pr: null, dispatchable: true, version: 1_000, ...over,
});
const pr = (over: Partial<TrackedPr> = {}): TrackedPr => ({
  repo: "gmackie/bob", number: 324, url: "https://git.forgegraf.com/gmackie/bob/pulls/324", state: "open", checks: "pending", headSha: "a".repeat(40), checkedAt: 2_000, ...over,
});

describe("parseTrackedIssue", () => {
  it("keeps a valid issue and only its known fields", () => {
    expect(parseTrackedIssue({ ...issue({ pr: pr() }), extra: "x", description: "secret" })).toEqual(issue({ pr: pr() }));
  });
  it("clips long titles and drops non-https urls", () => {
    const parsed = parseTrackedIssue(issue({ title: "x".repeat(500), url: "javascript:alert(1)" }));
    expect(parsed?.title).toHaveLength(TITLE_MAX);
    expect(parsed?.url).toBeNull();
  });
  it("refuses malformed keys, states, versions and PRs", () => {
    expect(parseTrackedIssue(issue({ key: "bob-1" }))).toBeNull();
    expect(parseTrackedIssue({ ...issue(), state: { name: "X", type: "weird" } })).toBeNull();
    expect(parseTrackedIssue({ ...issue(), version: -1 })).toBeNull();
    expect(parseTrackedIssue(issue({ pr: pr({ headSha: "nope" }) }))).toBeNull();
    expect(parseTrackedIssue(issue({ pr: pr({ url: "http://git.forgegraf.com/x" }) }))).toBeNull();
  });
});

describe("parseIssueBatch", () => {
  it("drops invalid issues but keeps the batch, and de-duplicates complete ids", () => {
    const batch = parseIssueBatch({ contractVersion: "1", upserts: [issue(), { id: "bad" }], complete: { ids: ["a", "a", "b"] } });
    expect(batch?.upserts).toHaveLength(1);
    expect(batch?.complete?.ids).toEqual(["a", "b"]);
  });
  it("refuses a wrong envelope or an oversized batch", () => {
    expect(parseIssueBatch({ contractVersion: "2", upserts: [] })).toBeNull();
    expect(parseIssueBatch({ contractVersion: "1", upserts: Array.from({ length: MAX_ISSUES_PER_BATCH + 1 }, () => issue()) })).toBeNull();
    expect(parseIssueBatch({ contractVersion: "1", upserts: [], complete: { ids: [1] } })).toBeNull();
  });
});

describe("issueStation", () => {
  it("places by Kanbanger state, refined by the PR", () => {
    expect(issueStation(issue({ state: { name: "Backlog", type: "backlog" } }))).toBe("backlog");
    expect(issueStation(issue({ state: { name: "Todo", type: "unstarted" } }))).toBe("queue");
    expect(issueStation(issue())).toBe("agents");
    expect(issueStation(issue({ state: { name: "In Review", type: "started" } }))).toBe("review");
    expect(issueStation(issue({ pr: pr() }))).toBe("ci");
    expect(issueStation(issue({ pr: pr({ checks: "failure" }) }))).toBe("ci");
    expect(issueStation(issue({ pr: pr({ checks: "success" }) }))).toBe("review");
    expect(issueStation(issue({ pr: pr({ state: "merged", checks: "success" }) }))).toBe("deploy");
    expect(issueStation(issue({ state: { name: "Done", type: "completed" }, pr: pr({ state: "merged" }) }))).toBe("shipped");
    expect(issueStation(issue({ state: { name: "Canceled", type: "canceled" } }))).toBe("cancelled");
  });
});

describe("issueAttention", () => {
  it("is failed on red checks and stalled when a started issue sits untouched for a week", () => {
    expect(issueAttention(issue({ pr: pr({ checks: "failure" }) }))).toBe("failed");
    expect(issueAttention(issue(), 1_000 + ISSUE_STALE_AFTER_MS)).toBe("ok");
    expect(issueAttention(issue(), 1_001 + ISSUE_STALE_AFTER_MS)).toBe("stalled");
    expect(issueAttention(issue({ state: { name: "Todo", type: "unstarted" } }), 10 ** 12)).toBe("ok");
    expect(issueAttention(issue())).toBe("ok");
  });
});

describe("reduce with issues", () => {
  const snap = (issues?: TrackedIssue[]) => ({ type: "snapshot" as const, epoch: "e", seq: 1, plans: [], items: [], topology: [], coordinatorSeenAt: 1, ...(issues ? { issues } : {}) });
  it("replaces issues on a snapshot, upserts by version and removes on a delta", () => {
    let view = reduce(emptyView(), snap([issue()]));
    expect(Object.keys(view.issues)).toEqual([UUID]);
    view = reduce(view, { type: "delta", seq: 2, plans: [], items: [], coordinatorSeenAt: 2, issues: [issue({ title: "older", version: 500 })] });
    expect(view.issues[UUID]?.title).toBe("Readable floor");
    view = reduce(view, { type: "delta", seq: 3, plans: [], items: [], coordinatorSeenAt: 3, issues: [issue({ title: "newer", version: 2_000 })] });
    expect(view.issues[UUID]?.title).toBe("newer");
    view = reduce(view, { type: "delta", seq: 4, plans: [], items: [], coordinatorSeenAt: 4, issuesRemoved: [UUID] });
    expect(view.issues).toEqual({});
  });
  it("treats a snapshot from an edge without issues as having none", () => {
    const view = reduce(reduce(emptyView(), snap([issue()])), snap());
    expect(view.issues).toEqual({});
  });
});

describe("issue commands", () => {
  it("parses SetIssueState and DispatchIssue with UUIDs only", () => {
    expect(parseCommandInput("SetIssueState", { issueId: UUID, target: "done" })).toEqual({ operation: "SetIssueState", input: { issueId: UUID, target: "done" } });
    expect(parseCommandInput("SetIssueState", { issueId: "BOB-101", target: "done" })).toBeNull();
    expect(parseCommandInput("SetIssueState", { issueId: UUID, target: "shipped" })).toBeNull();
    expect(parseCommandInput("DispatchIssue", { issueId: UUID })).toEqual({ operation: "DispatchIssue", input: { issueId: UUID } });
  });
  it("asks to confirm closing, cancelling and dispatching", () => {
    expect(tierOf({ operation: "SetIssueState", input: { issueId: UUID, target: "in_review" } })).toBe(1);
    expect(tierOf({ operation: "SetIssueState", input: { issueId: UUID, target: "done" } })).toBe(2);
    expect(tierOf({ operation: "SetIssueState", input: { issueId: UUID, target: "canceled" } })).toBe(2);
    expect(tierOf({ operation: "DispatchIssue", input: { issueId: UUID } })).toBe(2);
  });
  it("offers moves to every other state, and dispatch only when allowed and not coordinated", () => {
    expect(issueTargetOf(issue())).toBe("in_progress");
    const labels = issueCommands(issue()).map((o) => o.label);
    expect(labels).toEqual(["Dispatch to an agent", "Move to Todo", "Move to In Review", "Move to Done", "Move to Canceled"]);
    expect(issueCommands(issue(), true).map((o) => o.label)).not.toContain("Dispatch to an agent");
    expect(issueCommands(issue({ dispatchable: false })).map((o) => o.label)).not.toContain("Dispatch to an agent");
    expect(issueCommands(issue({ state: { name: "Done", type: "completed" } })).map((o) => o.label)).toEqual(["Move to Todo", "Move to In Progress", "Move to In Review", "Move to Canceled"]);
  });
});
