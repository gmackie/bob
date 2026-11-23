import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { readBudgetStateRows } from "./budget-store.js";

/**
 * Regression (BOB-76): a Date interpolated into a raw sql`` template reaches
 * node-postgres as Date.toString() ("Sat Nov 07 2026 … (Coordinated Universal
 * Time)"), which Postgres rejects. PGlite accepts it, so the PGlite store tests
 * cannot see this; render the real query parameters instead.
 */
describe("readBudgetStateRows query parameters", () => {
  it("never binds a raw Date", async () => {
    const wheres: SQL[] = [];
    const chain = {
      from: () => chain,
      where: (condition: SQL) => {
        wheres.push(condition);
        return chain;
      },
      orderBy: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    };
    const fakeDb = { select: () => chain } as unknown as Parameters<typeof readBudgetStateRows>[0];
    await readBudgetStateRows(fakeDb, { now: new Date("2026-11-15T02:00:00Z") });
    const dialect = new PgDialect();
    expect(wheres).toHaveLength(4);
    for (const where of wheres) {
      const { params } = dialect.sqlToQuery(where);
      for (const param of params) expect(param).not.toBeInstanceOf(Date);
      expect(params.some((p) => typeof p === "string" && /^2026-\d\d-\d\dT/.test(p))).toBe(true);
    }
  });
});
