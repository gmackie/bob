import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dispatcher tests for `@bob/db/client`.
 *
 * Each case mutates `process.env`, then calls `vi.resetModules()` so the next
 * dynamic `import("./client.js")` evaluates fresh against the new env — this
 * is the cleanest way to test a module whose behavior is decided at top-level
 * (no `?query-string` import trick required: vitest fully supports module
 * cache invalidation between tests).
 *
 * The third case is deliberately race-sensitive: it queries a real Bob table
 * IMMEDIATELY after import, which only works if the PGlite path gates every
 * query behind a "bootstrap is done" promise. Without the gate, bootstrap
 * runs fire-and-forget on a microtask and the test would see an empty DB.
 */
describe("db client dispatcher (BOB_DB_DRIVER)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BOB_DB_DRIVER;
    delete process.env.BOB_DB_PGLITE_DIR;
    // Provide a plausible DATABASE_URL so the default pg path can construct
    // a pool (it lazy-connects, so no real Postgres is required).
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/test";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("defaults to pg when BOB_DB_DRIVER is unset", async () => {
    const mod = await import("./client.js");
    // pg path: pool lazy-connects, so `db` just needs to exist.
    expect(mod.db).toBeDefined();
  });

  // Booting a fresh in-memory PGlite instance and applying the full schema
  // is expensive enough that it can exceed vitest's default 5000ms test
  // timeout under heavy concurrent CPU load (many other packages' test
  // suites running simultaneously via turbo) -- give these three PGlite
  // bootstrap cases explicit headroom rather than relying on the ambient
  // config value.
  it("routes to PGlite when BOB_DB_DRIVER=pglite", async () => {
    process.env.BOB_DB_DRIVER = "pglite";
    process.env.BOB_DB_PGLITE_DIR = ":memory:";
    const mod = await import("./client.js");
    expect(mod.db).toBeDefined();
    const { sql } = await import("drizzle-orm");
    // Must await the gated ready promise (proxy) before hitting the DB.
    const result = await mod.db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toMatchObject({ one: 1 });
  }, 30_000);

  it("PGlite path applies full schema before first query (race-safe)", async () => {
    process.env.BOB_DB_DRIVER = "pglite";
    process.env.BOB_DB_PGLITE_DIR = ":memory:";
    const mod = await import("./client.js");
    const { sql } = await import("drizzle-orm");
    // Real Bob table — proves bootstrap ran before this query resolved.
    // If the gate is absent, this throws "relation work_items does not exist".
    const result = await mod.db.execute(
      sql.raw(`select count(*)::int as c from "work_items"`),
    );
    expect((result.rows[0] as { c: number }).c).toBe(0);
  }, 30_000);

  it("PGlite path preserves snake_case mapping for relational queries", async () => {
    process.env.BOB_DB_DRIVER = "pglite";
    process.env.BOB_DB_PGLITE_DIR = ":memory:";
    const mod = await import("./client.js");

    await expect(mod.db.query.workspaces.findMany({ limit: 1 })).resolves.toEqual([]);
  }, 30_000);
});
