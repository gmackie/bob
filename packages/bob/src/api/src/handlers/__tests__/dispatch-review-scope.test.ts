import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dispatchBatches, dispatchItems } from "@bob/db/schema";

import type { HandlerContext } from "../context";
import { dispatchGetBatch, dispatchListBatches } from "../dispatch";

// Execute the handler's actual SQL predicates against temporary PostgreSQL
// tables. Nothing is written to the shared application's tables.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const database = drizzle(client, {
  schema: { dispatchBatches, dispatchItems },
  casing: "snake_case",
});
const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const workspace = "44444444-4444-4444-8444-444444444444";
const ctx = {
  userId: "owner",
  db: {
    query: {
      dispatchBatches: {
        findMany: (options: { where: SQL; orderBy: SQL; limit: number }) =>
          database.query.dispatchBatches.findMany({
            ...options,
            columns: { id: true },
          }),
        findFirst: (options: { where: SQL }) =>
          database.query.dispatchBatches.findFirst({
            ...options,
            columns: {
              id: true,
              workspaceId: true,
              userId: true,
              status: true,
            },
          }),
      },
      dispatchItems: {
        findMany: async (options: { where: SQL }) =>
          (
            await database.query.dispatchItems.findMany({
              where: options.where,
              columns: { id: true },
            })
          ).map((row) => ({ ...row, taskRun: null })),
      },
    },
  },
} as unknown as HandlerContext;

beforeAll(async () => {
  await client.connect();
  await client.query(`
    create temporary table dispatch_batches (id text, user_id text, workspace_id text, status text, created_at timestamp);
    create temporary table dispatch_items (id text, batch_id text, planning_task_id text);
    create temporary table work_items (id uuid, parent_id uuid, workspace_id uuid, external_id text);
    insert into work_items values
      ('${parent}', null, '${workspace}', null),
      ('${child}', '${parent}', '${workspace}', 'external-child'),
      ('${other}', null, '${workspace}', null);
    insert into dispatch_batches values
      ('own', 'owner', '${workspace}', 'completed', '2026-01-01'),
      ('unrelated-newer', 'owner', '${workspace}', 'completed', '2026-02-01'),
      ('foreign-owner', 'someone-else', '${workspace}', 'completed', '2026-03-01');
    insert into dispatch_items values
      ('child-result', 'own', 'external-child'),
      ('unrelated-in-same-batch', 'own', '${other}'),
      ('other-result', 'unrelated-newer', '${other}'),
      ('foreign-result', 'foreign-owner', '${child}');
  `);
});
afterAll(async () => {
  await client.end();
});

describe("review dispatch scope", () => {
  it("filters before limiting, includes children/external IDs, and preserves ownership", async () => {
    const batches = await dispatchListBatches(ctx, {
      workItemId: parent,
      limit: 1,
    });
    expect(batches.map((batch) => batch.id)).toEqual(["own"]);
  });
  it("can find a child directly by its canonical work-item ID", async () => {
    const batches = await dispatchListBatches(ctx, {
      workItemId: child,
      limit: 1,
    });
    expect(batches.map((batch) => batch.id)).toEqual(["own"]);
  });
  it("does not substitute an unrelated project batch when there is no matching work", async () => {
    expect(
      await dispatchListBatches(ctx, {
        workItemId: "55555555-5555-4555-8555-555555555555",
        limit: 1,
      }),
    ).toEqual([]);
  });
  it("returns only matching items from a mixed batch", async () => {
    const result = await dispatchGetBatch(ctx, {
      batchId: "own",
      workItemId: parent,
    });
    expect(result.items.map((item) => item.id)).toEqual(["child-result"]);
  });
  it("preserves the unfiltered list for existing callers", async () => {
    expect(
      (await dispatchListBatches(ctx, { limit: 1 })).map((batch) => batch.id),
    ).toEqual(["unrelated-newer"]);
  });
});
