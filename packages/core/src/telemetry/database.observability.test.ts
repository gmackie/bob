import { captureObservability } from "@forgegraph/otel/testing";
import { sql } from "drizzle-orm";
import { createDatabaseConnection } from "../db/client";
import { expect, it } from "vitest";
import { wrapFetch } from "./worker";

it.skipIf(!process.env.DATABASE_URL_TEST)("connects real PostgreSQL writes, reads and rollback to the Worker request", async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error("An isolated DATABASE_URL_TEST ending in _test is required");
  }
  const connection = await createDatabaseConnection({ driver: "postgres", url });
  const db = connection.db;
  const tasks: Promise<unknown>[] = [];
  try {
    const { graph, result } = await captureObservability({
      name: "Bob PostgreSQL latency/observability",
      spans: [
        { id: "request", selector: { service: "bob", name: "GET /health" }, maxCount: 1 },
        { id: "transaction", selector: { name: "db.transaction" }, maxCount: 1 },
        { id: "write", selector: { name: "db.insert" }, minCount: 2, maxCount: 2 },
        { id: "read", selector: { name: "db.select" }, maxCount: 1 },
        { id: "rollback", selector: { name: "db.savepoint" }, maxCount: 1, allowErrors: true },
      ],
      connections: [
        { from: "request", to: "transaction", kind: "parent" },
        { from: "transaction", to: "write", kind: "path" },
        { from: "transaction", to: "read", kind: "parent" },
      ],
    }, async endpoint => {
      const handler = wrapFetch(async () => {
          await db.transaction(async tx => {
            await tx.execute(sql`CREATE TEMPORARY TABLE span_fixture (id INTEGER PRIMARY KEY, secret TEXT) ON COMMIT DROP`);
            await tx.execute(sql`INSERT INTO span_fixture VALUES (1, ${"private fixture value"})`);
            const rollback = new Error("private rollback reason");
            await expect(tx.transaction(async nested => {
              await nested.execute(sql`INSERT INTO span_fixture VALUES (2, ${"private rolled-back value"})`);
              throw rollback;
            })).rejects.toBe(rollback);
            expect(await tx.execute(sql`SELECT id FROM span_fixture`)).toEqual([{ id: 1 }]);
          });
          return new Response("ok");
        }, { serviceName: "bob" });
      await handler(new Request("https://fixture/health"), { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }, { waitUntil: task => { tasks.push(task); } });
      await Promise.all(tasks);
    }, { directory: process.env.FG_OTEL_REPORT_DIR ?? ".fg/observability/database", revision: process.env.FG_OBSERVABILITY_REVISION });
    expect(result.passed, JSON.stringify(result.failures)).toBe(true);
    const serialized = JSON.stringify(graph);
    expect(serialized).not.toContain("private fixture value");
    expect(serialized).not.toContain("private rollback reason");
    expect(serialized).not.toContain("span_fixture");
  } finally {
    await connection.close();
  }
});
