import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makePgliteDb, type PgliteDbHandle } from "./client-pglite.js";

describe("client-pglite", () => {
  let handle: PgliteDbHandle;

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("connects in-memory and runs a trivial query", async () => {
    const result = await handle.db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toMatchObject({ one: 1 });
  });

  it("creates a table and round-trips a row", async () => {
    await handle.db.execute(sql`create table t (id serial primary key, name text)`);
    await handle.db.execute(sql`insert into t (name) values ('hello')`);
    const result = await handle.db.execute(sql`select name from t`);
    expect(result.rows[0]).toMatchObject({ name: "hello" });
  });

  it("boots with Bob's full schema applied (real schema, empty db)", async () => {
    // Fresh in-memory instance so we exercise the empty-DB bootstrap path —
    // the shared `handle` in beforeAll has already had bootstrap run against
    // it, which we also want to cover, but using a distinct handle keeps this
    // assertion about "empty → fully schema'd" explicit.
    const h = await makePgliteDb({ dataDir: ":memory:" });
    try {
      // Exercise a spread of real Bob tables from schema.ts (+ re-exports).
      // Each must return 0 rows without a schema error — proving the bootstrap
      // brought up the target schema, not just tracking tables.
      const tables = [
        "work_items", // packages/db/src/schema.ts
        "agent_runs",
        "tenants",
        "user", // packages/bob/src/auth/src/schema.ts
        "users", // gmacko auth table (Phase 7B-3)
      ];
      for (const t of tables) {
        const result = await h.db.execute(
          sql.raw(`select count(*)::int as c from "${t}"`),
        );
        expect((result.rows[0] as { c: number }).c).toBe(0);
      }
    } finally {
      await h.close();
    }
  });

  it("is idempotent on repeat init against the same dataDir", async () => {
    // Using an in-memory DB means "same data" is really "same process handle";
    // we simulate persistence by reusing the shared handle's client. A fresh
    // makePgliteDb call against a persistent directory would hit the
    // BOOTSTRAP_MARKER short-circuit. For the in-memory case, simply confirm
    // calling bootstrapSchema again against an already-bootstrapped client
    // doesn't throw (tables already exist).
    const { bootstrapSchema } = await import("./client-pglite.js");
    await expect(bootstrapSchema(handle.client)).resolves.toBeUndefined();
  });
});
