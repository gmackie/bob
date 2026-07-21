import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { BobNotFoundError } from "@gmacko/bob/contracts";

import { makeSnapshotRpcHandlers } from "../rpc-handlers/snapshot";
import type { HandlerContext } from "../handlers/context";

// ---------------------------------------------------------------------------
// Mock helpers — replicate the Drizzle query-builder chain shapes used by
// the snapshot handlers without pulling in a real database.
// ---------------------------------------------------------------------------

const SNAP_ROW = {
  id: "snap-1",
  workItemId: "wi-1",
  stage: "plan",
  data: { foo: "bar" },
  createdAt: "2026-01-01T00:00:00Z",
};

const WORK_ITEM = { id: "wi-1", workspaceId: "ws-1" };
const MEMBER = { id: "member-1" };

/**
 * Build a mock Drizzle `db` that satisfies the chains in snapshot.ts.
 *
 * `select().from().where().orderBy()` and `.limit()` are covered,
 * as are `insert().values().returning()` and `query.*` relation helpers.
 */
function makeMockDb(overrides?: {
  workItem?: typeof WORK_ITEM | null;
  member?: typeof MEMBER | null;
  selectRows?: unknown[];
  insertRows?: unknown[];
}) {
  const opts = overrides ?? {};
  const workItem = "workItem" in opts ? opts.workItem : WORK_ITEM;
  const member = "member" in opts ? opts.member : MEMBER;
  const selectRows = opts.selectRows ?? [SNAP_ROW];
  const insertRows = opts.insertRows ?? [{ ...SNAP_ROW, id: "snap-new" }];

  return {
    // Relation-style queries used by loadAccessibleWorkItem
    query: {
      workItems: {
        findFirst: () => Promise.resolve(workItem),
      },
      workspaceMembers: {
        findFirst: () => Promise.resolve(member),
      },
    },

    // Builder-style select: select().from().where().[orderBy() | limit()]
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(selectRows),
          limit: () => Promise.resolve(selectRows),
        }),
      }),
    }),

    // Builder-style insert: insert().values().returning()
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(insertRows),
      }),
    }),
    // The partial mock only implements the chains snapshot.ts exercises.
  } as unknown as HandlerContext["db"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("snapshot RPC handlers", () => {
  it("planning.snapshot.create resolves with the inserted row", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb(),
      userId: "user-1",
    });

    const result = await Effect.runPromise(
      handlers["planning.snapshot.create"]({
        payload: { workItemId: "wi-1", stage: "plan", data: { foo: "bar" } },
      }),
    );

    expect(result).toBeDefined();
    expect(result?.id).toBe("snap-new");
  });

  it("planning.snapshot.list resolves to an array", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb(),
      userId: "user-1",
    });

    const result = await Effect.runPromise(
      handlers["planning.snapshot.list"]({ payload: { workItemId: "wi-1" } }),
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("snap-1");
  });

  it("planning.snapshot.get resolves to the snapshot", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb(),
      userId: "user-1",
    });

    const result = await Effect.runPromise(
      handlers["planning.snapshot.get"]({ payload: { id: "snap-1" } }),
    );

    expect(result).toBeDefined();
    expect(result?.id).toBe("snap-1");
  });

  it("planning.snapshot.get returns null when row missing", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb({ selectRows: [] }),
      userId: "user-1",
    });

    const result = await Effect.runPromise(
      handlers["planning.snapshot.get"]({ payload: { id: "no-such" } }),
    );

    expect(result).toBeNull();
  });

  it("planning.snapshot.create fails with BobNotFoundError when work item missing", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb({ workItem: null }),
      userId: "user-1",
    });

    const error = await Effect.runPromise(
      handlers["planning.snapshot.create"]({
        payload: { workItemId: "bad", stage: "plan", data: {} },
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(BobNotFoundError);
  });

  it("planning.snapshot.list fails with BobNotFoundError when no membership", async () => {
    const handlers = makeSnapshotRpcHandlers({
      db: makeMockDb({ member: null }),
      userId: "user-1",
    });

    const error = await Effect.runPromise(
      handlers["planning.snapshot.list"]({
        payload: { workItemId: "wi-1" },
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(BobNotFoundError);
  });
});
