import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { makePgliteDb, type PgliteDbHandle } from "./client-pglite.js";
import { agentRuns, chatConversations, tenants, user, workspaces } from "./schema.js";
import { registerSessionAgentRun } from "./session-agent-run.js";

let handle: PgliteDbHandle;
const tenantId = randomUUID();
const workspaceId = randomUUID();
beforeAll(async () => {
  handle = await makePgliteDb({ dataDir: ":memory:" });
  await handle.db.insert(user).values({ id: "run-owner", name: "Owner", email: "owner@run.test" });
  await handle.db.insert(tenants).values({ id: tenantId, name: "Run test", slug: "run-test" });
  await handle.db.insert(workspaces).values({ id: workspaceId, tenantId, ownerUserId: "run-owner", name: "Run test", slug: "run-test" });
}, 30_000);
afterAll(async () => { await handle?.close(); });

it("reuses one run when the gateway and reporter register the same session", async () => {
  const sessionId = randomUUID();
  await handle.db.insert(chatConversations).values({ id: sessionId, userId: "run-owner" });
  const input = { sessionId, tenantId, workspaceId, workItemId: "work-1", agentType: "codex" };
  const db = handle.db as unknown as Db;
  const [gateway, reporter] = await Promise.all([
    registerSessionAgentRun(db, { ...input, status: "running" }),
    registerSessionAgentRun(db, { ...input, status: "queued" }),
  ]);
  expect(reporter.id).toBe(gateway.id);
  await handle.db.update(agentRuns).set({ status: "completed" }).where(eq(agentRuns.id, gateway.id));
  const replay = await registerSessionAgentRun(db, { ...input, status: "queued" });
  expect(replay.status).toBe("completed");
  await expect(registerSessionAgentRun(db, { ...input, workspaceId: randomUUID() })).rejects.toThrow("ownership mismatch");
  const secondSessionId = randomUUID();
  await handle.db.insert(chatConversations).values({ id: secondSessionId, userId: "run-owner" });
  const retry = await registerSessionAgentRun(db, { ...input, sessionId: secondSessionId });
  expect(retry.id).not.toBe(gateway.id);
  expect(await handle.db.select().from(agentRuns).where(eq(agentRuns.sessionId, sessionId))).toHaveLength(1);
});
