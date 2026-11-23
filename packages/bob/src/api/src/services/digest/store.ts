import { and, eq, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { digestDeliveries, digestDestinations } from "@bob/db/schema";

import type { DigestStore } from "./destination.js";

export function makeDigestStore(database: typeof db): DigestStore {
  return {
    async destination(scope, workspaceId) {
      await database
        .insert(digestDestinations)
        .values({ scope, workspaceId })
        .onConflictDoNothing();
      const [row] = await database
        .select()
        .from(digestDestinations)
        .where(eq(digestDestinations.scope, scope));
      if (!row) throw new Error("Missing digest destination reservation");
      return row;
    },
    async claimDestination(scope) {
      const rows = await database
        .update(digestDestinations)
        .set({ phase: "sending" })
        .where(
          and(
            eq(digestDestinations.scope, scope),
            eq(digestDestinations.phase, "ready"),
          ),
        )
        .returning();
      return rows.length === 1;
    },
    async link(scope, id) {
      const [row] = await database
        .update(digestDestinations)
        .set({
          issueId: sql`coalesce(${digestDestinations.issueId}, ${id})`,
          phase: "linked",
        })
        .where(eq(digestDestinations.scope, scope))
        .returning();
      if (!row?.issueId) throw new Error("Failed to link digest destination");
      return row.issueId;
    },
    async retryDestination(scope) {
      await database
        .update(digestDestinations)
        .set({ phase: "ready" })
        .where(
          and(
            eq(digestDestinations.scope, scope),
            eq(digestDestinations.phase, "sending"),
          ),
        );
    },
    async claimDate(scope, date) {
      const key = JSON.stringify([scope, date]);
      await database
        .insert(digestDeliveries)
        .values({ key, scope, date })
        .onConflictDoNothing();
      const rows = await database
        .update(digestDeliveries)
        .set({ phase: "sending" })
        .where(
          and(
            eq(digestDeliveries.key, key),
            eq(digestDeliveries.phase, "ready"),
          ),
        )
        .returning();
      return rows.length === 1;
    },
    async posted(scope, date) {
      await database
        .insert(digestDeliveries)
        .values({
          key: JSON.stringify([scope, date]),
          scope,
          date,
          phase: "posted",
        })
        .onConflictDoUpdate({
          target: digestDeliveries.key,
          set: { phase: "posted" },
        });
    },
    async retryDate(scope, date) {
      await database
        .update(digestDeliveries)
        .set({ phase: "ready" })
        .where(
          and(
            eq(digestDeliveries.key, JSON.stringify([scope, date])),
            eq(digestDeliveries.phase, "sending"),
          ),
        );
    },
  };
}
export const digestStore = makeDigestStore(db);
