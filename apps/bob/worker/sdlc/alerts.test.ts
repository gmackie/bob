import { describe, expect, it, vi } from "vitest";
import type { ItemSnapshot, PendingInput, PlanSnapshot } from "@bob/sdlc-view";
import { sendAlertsThroughBob } from "./alert-send";
import { describeAlert, MAX_ALERTED_ROWS, PUSH_LIMIT, type SdlcAlertDelivery } from "./alerts";
import { EdgeController } from "./controller";
import { EdgeStore, type IngestBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

const target = { environmentId: "hetzner-bob", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "gmackie/bob" } };
const issue = (n: string) => ({ integrationId: "kanbanger", workspaceId: "gmacko", teamId: "BOB", projectId: "bob", issueId: `i-${n}`, identifier: `BOB-${n}` });
const plan = (ids: string[], state: PlanSnapshot["state"] = "active", resourceVersion = 1): PlanSnapshot =>
  ({ planId: "p", resourceVersion, state, definition: { items: ids.map((itemId) => ({ itemId, issue: issue(itemId), target, completionTarget: "production" })), dependencies: [], concurrencyLimit: 1 } });
const prompt = (promptId: string, question = "Ship it?"): PendingInput =>
  ({ attemptId: "a1", promptId, kind: "user_input", createdAt: "2026-11-15T00:00:00Z", questions: [{ id: "q", question, options: [], multiSelect: false }] });
const item = (itemId: string, resourceVersion: number, state: ItemSnapshot["state"] = "running", pendingInput: PendingInput | null = null): ItemSnapshot =>
  ({ itemId, planId: "p", resourceVersion, state, currentAttemptId: "a1", execution: null, pendingInput, achievedMilestones: [], operationIds: [], evidenceRefs: [] });

function harness(viewers = ["u1", "u2"]) {
  const sql = nodeSqlitePort();
  let clock = 1_000;
  const sent: SdlcAlertDelivery[][] = [];
  const edge = new EdgeController({
    sql, sockets: () => [], now: () => clock, newEpoch: () => "e",
    alertRecipients: () => viewers, notify: (d) => { sent.push(d); },
  });
  let watermark = 0;
  /** Sends a changes batch continuing from the edge's watermark. */
  const change = (items: ItemSnapshot[], plans: PlanSnapshot[] = []) => {
    const from = watermark;
    watermark += 1;
    return edge.ingest({ contractVersion: "1", kind: "changes", fromSequence: from, watermark, plans, items });
  };
  const snapshot = (items: ItemSnapshot[], plans: PlanSnapshot[] = [plan(items.map((i) => i.itemId))]) => {
    watermark += 1;
    return edge.ingest({ contractVersion: "1", kind: "snapshot", watermark, plans, items } satisfies IngestBatch);
  };
  const titles = () => sent.flat().map((d) => `${d.userId}:${d.title}`);
  return { sql, edge, sent, change, snapshot, titles, tick: (ms: number) => { clock += ms; } };
}

describe("SDLC alerts", () => {
  it("alerts every viewer once when an item enters waiting-input, review or failed", () => {
    const h = harness();
    h.snapshot([item("71", 1), item("72", 1), item("73", 1)]);
    expect(h.sent).toEqual([]);
    h.change([item("71", 2, "waiting-input", prompt("r1")), item("72", 2, "review"), item("73", 2, "failed")]);
    expect(h.titles()).toEqual([
      "u1:BOB-71 needs your answer", "u1:BOB-72 is ready for review", "u1:BOB-73 failed",
      "u2:BOB-71 needs your answer", "u2:BOB-72 is ready for review", "u2:BOB-73 failed",
    ]);
    expect(h.sent[0]?.[0]).toEqual({ userId: "u1", type: "sdlc_waiting_input", title: "BOB-71 needs your answer", body: "gmackie/bob · plan p: Ship it?", itemId: "71", url: "/sdlc?item=71" });
  });

  it("does not re-alert on a replay, a newer version in the same state, or a resync snapshot", () => {
    const h = harness(["u1"]);
    h.snapshot([item("71", 1)]);
    h.change([item("71", 2, "review")]);
    expect(h.titles()).toEqual(["u1:BOB-71 is ready for review"]);
    h.change([item("71", 3, "review")]);
    h.snapshot([item("71", 3, "review")]);
    h.snapshot([item("71", 4, "review")]);
    expect(h.titles()).toEqual(["u1:BOB-71 is ready for review"]);
  });

  it("alerts again after the item leaves the state and comes back, and for a new prompt", () => {
    const h = harness(["u1"]);
    h.snapshot([item("71", 1)]);
    h.change([item("71", 2, "waiting-input", prompt("r1"))]);
    h.change([item("71", 3, "waiting-input", prompt("r1"))]);
    h.change([item("71", 4, "waiting-input", prompt("r2", "Which env?"))]);
    h.change([item("71", 5, "running")]);
    h.change([item("71", 6, "review")]);
    expect(h.titles()).toEqual(["u1:BOB-71 needs your answer", "u1:BOB-71 needs your answer", "u1:BOB-71 is ready for review"]);
  });

  it("treats a fresh edge's first snapshot as a baseline, but alerts what a later snapshot newly shows", () => {
    const h = harness(["u1"]);
    h.snapshot([item("71", 5, "failed"), item("72", 1)]);
    expect(h.sent).toEqual([]);
    h.snapshot([item("71", 5, "failed"), item("72", 2, "failed")]);
    expect(h.titles()).toEqual(["u1:BOB-72 failed"]);
  });

  it("does not alert an item the edge already held in the state before alerts were recorded", () => {
    const sql = nodeSqlitePort();
    const before = new EdgeStore(sql, () => "e");
    before.apply({ contractVersion: "1", kind: "snapshot", watermark: 1, plans: [plan(["71"])], items: [item("71", 1, "review")] }, 1);
    sql.exec("DELETE FROM sdlc_alerted"); // as on the first deploy of this feature
    const sent: SdlcAlertDelivery[][] = [];
    const edge = new EdgeController({ sql, sockets: () => [], newEpoch: () => "e", alertRecipients: () => ["u1"], notify: (d) => { sent.push(d); } });
    edge.ingest({ contractVersion: "1", kind: "snapshot", watermark: 2, plans: [plan(["71"])], items: [item("71", 2, "review")] });
    expect(sent).toEqual([]);
    expect(sql.exec("SELECT item_id, alert_key FROM sdlc_alerted")).toEqual([{ item_id: "71", alert_key: "review" }]);
  });

  it(`limits each user to ${PUSH_LIMIT.perUser} pushes per window, coalescing the rest into one summary`, () => {
    const ids = Array.from({ length: 14 }, (_, n) => String(100 + n));
    const h = harness(["u1"]);
    h.snapshot(ids.map((id) => item(id, 1)), [plan(ids)]);
    h.change(ids.slice(0, 12).map((id) => item(id, 2, "failed")));
    const first = h.sent.flat();
    expect(first).toHaveLength(PUSH_LIMIT.perUser);
    expect(first.at(-1)).toMatchObject({ type: "sdlc_failed", title: "3 more SDLC items need attention", itemId: null, url: "/sdlc" });
    h.change([item("112", 2, "waiting-input", prompt("r1"))]);
    expect(h.sent.flat()).toHaveLength(PUSH_LIMIT.perUser); // over the limit: dropped, the Attention tab still shows it
    h.tick(PUSH_LIMIT.windowMs);
    h.change([item("113", 2, "review")]);
    expect(h.titles().at(-1)).toBe("u1:BOB-113 is ready for review");
  });

  it("prunes recorded alerts for items of an ended plan", () => {
    const h = harness(["u1"]);
    h.snapshot([item("71", 1)]);
    h.change([item("71", 2, "failed")]);
    expect(h.sql.exec("SELECT item_id FROM sdlc_alerted")).toHaveLength(1);
    h.change([], [plan(["71"], "cancelled", 2)]);
    expect(h.sql.exec("SELECT item_id FROM sdlc_alerted")).toEqual([]);
    expect(MAX_ALERTED_ROWS).toBeGreaterThan(0);
  });

  it("plans nothing without a sender or viewers, and never fails ingest when the sender throws", () => {
    const quiet = new EdgeController({ sql: nodeSqlitePort(), sockets: () => [], newEpoch: () => "e", alertRecipients: () => ["u1"] });
    quiet.ingest({ contractVersion: "1", kind: "snapshot", watermark: 1, plans: [plan(["71"])], items: [item("71", 1)] });
    quiet.ingest({ contractVersion: "1", kind: "changes", fromSequence: 1, watermark: 2, plans: [], items: [item("71", 2, "failed")] });
    expect(quiet.store.alerts.plan([], ["u1"], 0)).toEqual([]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const loud = new EdgeController({ sql: nodeSqlitePort(), sockets: () => [], newEpoch: () => "e", alertRecipients: () => ["u1"], notify: () => { throw new Error("boom"); } });
    loud.ingest({ contractVersion: "1", kind: "snapshot", watermark: 1, plans: [plan(["71"])], items: [item("71", 1)] });
    expect(loud.ingest({ contractVersion: "1", kind: "changes", fromSequence: 1, watermark: 2, plans: [], items: [item("71", 2, "failed")] })).toMatchObject({ accepted: true, watermark: 2 });
    expect(loud.store.item("71")?.state).toBe("failed");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("sdlc_edge_alert_failed"));
    error.mockRestore();
  });

  it("strips terminal controls from agent text and falls back to the item id", () => {
    const evil = item("71", 2, "waiting-input", prompt("r1", "\u001b[31mDeploy\u001b[0m\nnow?"));
    expect(describeAlert({ itemId: "71", planId: "p", state: "waiting-input", resourceVersion: 2 }, evil, plan(["71"])).body).toBe("gmackie/bob · plan p: Deploy now?");
    expect(describeAlert({ itemId: "x/1", planId: "p", state: "failed", resourceVersion: 1 }, undefined, undefined)).toMatchObject({ title: "x/1 failed", body: "plan p", url: "/sdlc?item=x%2F1" });
  });
});

describe("sendAlertsThroughBob", () => {
  const delivery: SdlcAlertDelivery = { userId: "u1", type: "sdlc_review", title: "t", body: "b", itemId: "71", url: "/sdlc?item=71" };
  it("opens Bob's database over Hyperdrive and hands the deliveries to the notification service", async () => {
    const send = vi.fn(async () => 1);
    const calls: Array<[string, boolean]> = [];
    const runWithDb = <T>(url: string, isHyperdrive: boolean, fn: () => Promise<T>) => { calls.push([url, isHyperdrive]); return fn(); };
    vi.spyOn(console, "log").mockImplementation(() => {});
    await sendAlertsThroughBob({ HYPERDRIVE: { connectionString: "postgres://hd" } }, [delivery], {
      connection: (env) => ({ connectionString: env.HYPERDRIVE!.connectionString, isHyperdrive: true }), runWithDb, send,
    });
    expect(calls).toEqual([["postgres://hd", true]]);
    expect(send).toHaveBeenCalledWith([delivery]);
  });
  it("logs and swallows a failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendAlertsThroughBob({}, [delivery], {
      connection: () => { throw new Error("no db"); }, runWithDb: vi.fn(), send: vi.fn(),
    })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("sdlc_edge_alerts_failed"));
    error.mockRestore();
  });
});
