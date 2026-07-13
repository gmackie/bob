import { describe, it, expect, vi, beforeEach } from "vitest";

const pushToUser = vi.fn();
const pruneTokens = vi.fn((_tokens: string[]) => Promise.resolve());
vi.mock("./push.js", () => ({
  pushToUser: (...a: unknown[]) => pushToUser(...a),
  pruneTokens: (tokens: string[]) => pruneTokens(tokens),
}));

// db mock: update().set().where().returning() drives the claim; tests set
// `claimedRows` to control what the worker sees. Every set() payload is
// recorded for assertions.
const setPayloads: Array<{ payload: any; hasReturning: boolean }> = [];
let claimedRows: any[] = [];
let findManyRows: any[] = [];
const onConflictDoNothing = vi.fn(() => Promise.resolve());

vi.mock("@bob/db/client", () => {
  const dbObj: any = {
    query: {
      notificationOutbox: { findMany: vi.fn(() => Promise.resolve(findManyRows)) },
    },
    // Bounded-claim subquery: db.select().from().where().orderBy().limit().for()
    // is passed to inArray on the update; the update mock ignores its where arg.
    select: vi.fn(() => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: () => chain,
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (payload: any) => ({
        where: () => {
          const p: any = Promise.resolve();
          p.returning = () => {
            setPayloads.push({ payload, hasReturning: true });
            return Promise.resolve(payload.status === "claimed" ? claimedRows : []);
          };
          setPayloads.push({ payload, hasReturning: false });
          return p;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing })),
    })),
  };
  return { db: dbObj };
});

import { enqueueTransition, OutboxWorker } from "./outbox.js";
import { db } from "@bob/db/client";

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    sessionId: "77777777-7777-4777-8777-777777777777",
    userId: "user-1",
    transition: "completed",
    sourceSendSeq: 12,
    status: "claimed",
    attempts: 1,
    messageId: "msg-1",
    payload: {
      title: "Task done",
      body: "finished",
      data: { sessionId: "77777777-7777-4777-8777-777777777777" },
      channelId: "tasks",
      priority: "high",
    },
    ...overrides,
  };
}

describe("outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPayloads.length = 0;
    claimedRows = [];
    findManyRows = [];
    onConflictDoNothing.mockResolvedValue(undefined as never);
  });

  it("enqueueTransition records send intent with conflict-ignore (exactly-once per occurrence)", async () => {
    await enqueueTransition({
      sessionId: "s1",
      userId: "u1",
      transition: "blocked",
      sourceSendSeq: 4,
      title: "needs you",
      body: "approval",
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("delivers a claimed row, stores tickets, and passes the stable messageId", async () => {
    claimedRows = [outboxRow()];
    pushToUser.mockResolvedValue({ delivered: true, tickets: { tokenA: "ticket-1" } });

    await new OutboxWorker().tick();

    expect(pushToUser).toHaveBeenCalledTimes(1);
    const [, notification] = pushToUser.mock.calls[0] as [string, any];
    expect(notification.data.messageId).toBe("msg-1");

    const sent = setPayloads.find((s) => s.payload.status === "sent");
    expect(sent).toBeDefined();
    expect(sent!.payload.expoTickets).toEqual({ tokenA: "ticket-1" });
  });

  it("returns a failed send to pending with the error recorded (retry)", async () => {
    claimedRows = [outboxRow({ attempts: 1 })];
    pushToUser.mockRejectedValue(new Error("Expo API 500"));

    await new OutboxWorker().tick();

    const retry = setPayloads.find(
      (s) => s.payload.status === "pending" && s.payload.lastError,
    );
    expect(retry).toBeDefined();
    expect(retry!.payload.lastError).toContain("Expo API 500");
  });

  it("gives up after MAX_ATTEMPTS and marks the row failed", async () => {
    claimedRows = [outboxRow({ attempts: 5 })];
    pushToUser.mockRejectedValue(new Error("still down"));

    await new OutboxWorker().tick();

    expect(setPayloads.some((s) => s.payload.status === "failed")).toBe(true);
  });

  it("reclaims rows stuck in claimed (the accepted ambiguous-send case)", async () => {
    await new OutboxWorker().tick();
    // First set() of the tick is the reclaim: claimed → pending.
    expect(setPayloads[0]!.payload.status).toBe("pending");
  });

  it("receipts cron prunes DeviceNotRegistered tokens and resolves the row", async () => {
    findManyRows = [
      outboxRow({ status: "sent", expoTickets: { deadToken: "ticket-9" } }),
    ];
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          "ticket-9": { status: "error", details: { error: "DeviceNotRegistered" } },
        },
      }),
    }));

    await new OutboxWorker().receiptsTick();

    expect(pruneTokens).toHaveBeenCalledWith(["deadToken"]);
    expect(setPayloads.some((s) => s.payload.receiptsResolvedAt)).toBe(true);
  });
});
