/**
 * GET /api/nodes — returns all runner_device rows.
 *
 * The runner_device table is defined in @gmacko/ooda's schema but lives in the
 * shared database. We define the table reference locally to avoid pulling in the
 * entire OODA package (which has Node-only deps like node-pty) into a CF Workers
 * build.
 */
import { desc } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { db } from "~/lib/db-client-lazy";

/** Minimal mirror of ooda's runnerDevice table — just enough for SELECT. */
const runnerDevice = pgTable("runner_device", (t) => ({
  id: t.uuid().notNull().primaryKey(),
  name: t.varchar({ length: 128 }).notNull(),
  hostname: t.varchar({ length: 256 }),
  status: t.varchar({ length: 32 }).notNull().default("online"),
  lastHeartbeatAt: t.timestamp({ mode: "string", withTimezone: true }),
  capabilities: t.json().$type<string[]>().notNull().default([]),
  registeredAt: t.timestamp({ mode: "string" }).notNull(),
}));

export const GET = async () => {
  try {
    const nodes = await db
      .select()
      .from(runnerDevice)
      .orderBy(desc(runnerDevice.registeredAt));

    return Response.json(nodes);
  } catch (err) {
    console.error("GET /api/nodes failed:", err);
    return Response.json(
      { error: "Failed to fetch nodes" },
      { status: 500 },
    );
  }
};
