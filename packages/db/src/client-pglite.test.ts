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
});
