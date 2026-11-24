import { afterAll, beforeAll, expect, it } from "vitest";

import type { Db } from "@bob/db/client";
import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { makePgliteDb } from "@bob/db/client-pglite";
import { agentRuns, chatConversations, tenants, user, workItems, workspaces } from "@bob/db/schema";

import { reconcileOrphanedClaims } from "../reconcileOrphanedClaims.js";

let handle: PgliteDbHandle;

const userId = "orphan-sweep-user";
const workspaceId = crypto.randomUUID();
const tenantId = crypto.randomUUID();
const ids = {
  activeRun: crypto.randomUUID(),
  activeSession: crypto.randomUUID(),
  endedRun: crypto.randomUUID(),
  neverDispatched: crypto.randomUUID(),
  recent: crypto.randomUUID(),
};

beforeAll(async () => {
  handle = await makePgliteDb({ dataDir: ":memory:" });
  const db = handle.db;
  await db.insert(user).values({ id: userId, name: "Owner", email: "owner@example.com" });
  await db.insert(tenants).values({ id: tenantId, name: "Sweep", slug: "sweep" });
  await db.insert(workspaces).values({
    id: workspaceId, ownerUserId: userId, name: "Sweep", slug: "sweep", tenantId,
  });
  const old = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  await db.insert(workItems).values(
    Object.entries(ids).map(([title, id]) => ({
      id, title, workspaceId, ownerUserId: userId, kind: "task" as const, status: "in_progress",
      createdAt: title === "recent" ? new Date().toISOString() : old,
      updatedAt: null, sourceMetadata: { attempts: 3 },
    })),
  );
  await db.insert(agentRuns).values([
    { workItemId: ids.activeRun, workspaceId, tenantId, agentType: "codex", status: "host_unknown" },
    { workItemId: ids.endedRun, workspaceId, tenantId, agentType: "codex", status: "interrupted" },
  ]);
  await db.insert(chatConversations).values({ userId, workItemId: ids.activeSession, status: "blocked" });
});

afterAll(async () => {
  await handle?.close();
});

it("previews and requeues only idle claims without a live session or run", async () => {
  // SAFETY: these queries use the shared Drizzle schema and never use a driver-specific result.
  const db = handle.db as Db;
  const preview = await reconcileOrphanedClaims({ dryRun: true }, db);
  expect(preview.items).toEqual(expect.arrayContaining([
    { id: ids.endedRun, reason: expect.stringMatching(/every run ended/) },
    { id: ids.neverDispatched, reason: expect.stringMatching(/never dispatched/) },
  ]));
  expect(preview.released).toBe(2);
  expect((await handle.db.select().from(workItems)).every(i => i.status === "in_progress")).toBe(true);

  const overlapping = await Promise.all([
    reconcileOrphanedClaims({ limit: 1 }, db),
    reconcileOrphanedClaims({ limit: 1 }, db),
  ]);
  const remaining = await reconcileOrphanedClaims({}, db);
  const released = [...overlapping, remaining].flatMap(r => r.items.map(i => i.id));
  expect(released.sort()).toEqual([ids.endedRun, ids.neverDispatched].sort());
  const rows = await handle.db.select().from(workItems);
  expect(rows.filter(i => i.status === "todo").map(i => i.id).sort()).toEqual(released);
  expect(rows.every(i => i.sourceMetadata.attempts === 3)).toBe(true);
  expect((await reconcileOrphanedClaims({}, db)).released).toBe(0);
});
