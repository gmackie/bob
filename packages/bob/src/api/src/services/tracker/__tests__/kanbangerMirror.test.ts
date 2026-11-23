import type { LinearClient } from "@linear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@bob/db/client";

import { applyChangesRequested, findChangesRequestComment, readChangesRequested } from "../changesRequested";
import { reportToKanbanger } from "../trackerMirror";
import type { MirrorEvent } from "../trackerMirror";

const WORKSPACE = "11111111-2222-4333-8444-555555555555";
const ISSUE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONFIG = { apiUrl: "https://tasks.gmac.io/graphql", apiKey: "lc_test" };
const PR = "https://git.forgegraf.com/gmackie/bob/pulls/7";

/** Minimal Drizzle-shaped fake: one work item row, recorded writes. */
function fakeDb(row: { status: string; sourceMetadata: Record<string, unknown> }) {
  const state = { ...row };
  const updates: Record<string, unknown>[] = [];
  const inserts: { values: Record<string, unknown> }[] = [];
  const db = {
    query: {
      workItems: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: "wi-1",
            status: state.status,
            sourceMetadata: state.sourceMetadata,
            description: null,
          }),
        ),
      },
      chatConversations: { findFirst: vi.fn(() => Promise.resolve({ id: "session-1" })) },
      pullRequests: { findFirst: vi.fn(() => Promise.resolve<{ url: string } | null>(null)) },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        if (typeof values.status === "string") state.status = values.status;
        if (values.sourceMetadata) state.sourceMetadata = values.sourceMetadata as Record<string, unknown>;
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ values });
        return Promise.resolve();
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: "session-1" }]) }) }),
  };
  return { db: db as unknown as Db, state, updates, inserts, raw: db };
}

const client = { organization: Promise.resolve({ id: WORKSPACE }) } as unknown as LinearClient;

const prOpened: MirrorEvent = {
  kind: "pr_opened",
  prUrl: PR,
  review: { summary: "Did it.", testPlan: ["Step 1"], commitUrl: null },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface SentReport {
  kind: string;
  status: string;
  [key: string]: unknown;
}

function bodyOf(init: RequestInit | undefined): SentReport {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as SentReport;
}

/** Every report POSTed through the spied fetch, in order. */
function sent(fetch: { mock: { calls: unknown[][] } }): SentReport[] {
  return fetch.mock.calls.map((call) => bodyOf(call[1] as RequestInit | undefined));
}

/** Route the two reports (PR fact, review request) to separate responses. */
function mockDelivery(reviewResponse: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
    Promise.resolve(bodyOf(init).kind === "pr" ? json(201, { event: {}, issueId: ISSUE }) : reviewResponse()),
  );
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("reportToKanbanger — ready for review", () => {
  it("success: reports revision 1, skips the GraphQL state move, records the revision", async () => {
    const { db, state } = fakeDb({ status: "in_review", sourceMetadata: {} });
    const fetch = mockDelivery(() => json(201, { event: {}, issueId: ISSUE }));

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "in_review", externalId: ISSUE, sourceMetadata: {} }, prOpened, CONFIG);

    expect(out.moveState).toBe(false);
    expect(out.delivery).toEqual({ ok: true, issueId: ISSUE });
    const bodies = sent(fetch);
    expect(bodies.map((b) => `${b.kind}:${b.status}`)).toEqual(["pr:opened", "review_request:ready"]);
    expect(bodies[1]).toMatchObject({
      issueId: ISSUE,
      subject: "bob:review:wi-1",
      externalId: "bob:review:wi-1:1",
      summary: "Did it.",
      url: PR,
      payload: { testPlan: ["Step 1"], artifacts: [{ type: "pr", url: PR }] },
    });
    expect(state.sourceMetadata.reviewRevision).toBe(1);
    expect(state.status).toBe("in_review");
  });

  it("409 gate-blocked: does not claim readiness — keeps the item in progress and records the blocker", async () => {
    const { db, state, inserts } = fakeDb({ status: "in_review", sourceMetadata: {} });
    mockDelivery(() => json(409, { _tag: "Conflict", reason: "progress-gate-blocked" }));

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "in_review", externalId: ISSUE, sourceMetadata: {} }, prOpened, CONFIG);

    expect(out.moveState).toBe(false); // no GraphQL move to In Review either
    expect(out.bobStatus).toBe("in_progress");
    expect(state.status).toBe("in_progress");
    expect(state.sourceMetadata.deliveryBlocked).toMatchObject({ reason: "progress-gate-blocked", prUrl: PR });
    expect(state.sourceMetadata.reviewRevision).toBeUndefined();
    const chat = inserts.find((i) => i.values.conversationId === "session-1");
    expect(chat?.values.content).toContain("unmet progress gates");
  });

  it("404: falls back to the previous GraphQL review-state behaviour", async () => {
    const { db, state } = fakeDb({ status: "in_review", sourceMetadata: {} });
    mockDelivery(() => new Response("Not Found", { status: 404 }));

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "in_review", externalId: ISSUE, sourceMetadata: {} }, prOpened, CONFIG);

    expect(out.moveState).toBe(true);
    expect(out.bobStatus).toBeUndefined();
    expect(state.status).toBe("in_review");
  });

  it("network error: falls back and never throws", async () => {
    const { db } = fakeDb({ status: "in_review", sourceMetadata: {} });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "in_review", externalId: ISSUE, sourceMetadata: {} }, prOpened, CONFIG);

    expect(out.moveState).toBe(true);
  });

  it("a re-report after requested changes uses the next revision", async () => {
    const { db } = fakeDb({ status: "in_review", sourceMetadata: { reviewRevision: 1 } });
    const fetch = mockDelivery(() => json(201, { event: {}, issueId: ISSUE }));

    await reportToKanbanger(
      db,
      client,
      { id: "wi-1", status: "in_review", externalId: ISSUE, sourceMetadata: { reviewRevision: 1 } },
      { kind: "review_ready", prUrl: PR, review: { summary: "Fixed.", testPlan: [] } },
      CONFIG,
    );

    const bodies = sent(fetch);
    expect(bodies).toHaveLength(1); // no second "PR opened" fact
    expect(bodies[0]).toMatchObject({ externalId: "bob:review:wi-1:2" });
  });
});

describe("reportToKanbanger — merge", () => {
  it("reports the merge as a fact and never moves the issue to Done itself", async () => {
    const { db } = fakeDb({ status: "done", sourceMetadata: {} });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "done", externalId: ISSUE, sourceMetadata: {} }, { kind: "merged", prUrl: PR }, CONFIG);

    expect(out.moveState).toBe(false); // even when the fact could not be recorded
    const body = sent(fetch)[0];
    expect(body).toMatchObject({ kind: "pr", status: "merged", subject: PR, externalId: PR });
  });

  it("claim keeps the GraphQL In Progress move", async () => {
    const { db } = fakeDb({ status: "in_progress", sourceMetadata: {} });
    const fetch = vi.spyOn(globalThis, "fetch");

    const out = await reportToKanbanger(db, client, { id: "wi-1", status: "in_progress", externalId: ISSUE, sourceMetadata: {} }, { kind: "claimed", agentType: "codex" }, CONFIG);

    expect(out.moveState).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("changes requested", () => {
  it("open PR → in_progress with a pending request routed to repair; idempotent on comment id", async () => {
    const { db, state, raw } = fakeDb({ status: "in_review", sourceMetadata: { deliveryBlocked: { reason: "x" } } });
    raw.query.pullRequests.findFirst.mockResolvedValue({ url: PR });

    const first = await applyChangesRequested(db, {
      issueKeys: [ISSUE],
      commentId: "c-1",
      body: "Changes requested: handle the empty state",
      source: "webhook",
    });

    expect(first).toEqual({ applied: true, workItemId: "wi-1", route: "repair" });
    expect(state.status).toBe("in_progress");
    expect(readChangesRequested(state.sourceMetadata)).toMatchObject({ note: "handle the empty state", prUrl: PR });
    expect(state.sourceMetadata.deliveryBlocked).toBeUndefined();

    const again = await applyChangesRequested(db, { issueKeys: [ISSUE], commentId: "c-1", body: "Changes requested: x", source: "sync" });
    expect(again).toEqual({ applied: false, reason: "already handled" });
  });

  it("no open PR → back to todo so autoDrain re-runs it with the note", async () => {
    const { db, state } = fakeDb({ status: "done", sourceMetadata: {} });

    const out = await applyChangesRequested(db, { issueKeys: ["GMA-612"], commentId: "c-2", body: "Changes requested: also cover mobile", source: "webhook" });

    expect(out).toMatchObject({ applied: true, route: "requeue" });
    expect(state.status).toBe("todo");
    expect(readChangesRequested(state.sourceMetadata)).toMatchObject({ prUrl: null, note: "also cover mobile" });
  });

  it("ignores ordinary comments", async () => {
    const { db } = fakeDb({ status: "in_review", sourceMetadata: {} });
    expect(await applyChangesRequested(db, { issueKeys: [ISSUE], commentId: "c-3", body: "Looks good", source: "webhook" })).toEqual({
      applied: false,
      reason: "not a change request",
    });
  });

  it("sync backstop picks the newest request after the last ready report", () => {
    const comments = [
      { id: "old", body: "Changes requested: first round", createdAt: "2026-10-01T00:00:00Z" },
      { id: "note", body: "Thanks!", createdAt: "2026-10-03T00:00:00Z" },
      { id: "new", body: "Changes requested: second round", createdAt: "2026-10-04T00:00:00Z" },
    ];
    expect(findChangesRequestComment(comments, "2026-10-02T00:00:00Z")).toEqual({ id: "new", body: "Changes requested: second round" });
    expect(findChangesRequestComment(comments, "2026-10-05T00:00:00Z")).toBeNull();
  });
});
