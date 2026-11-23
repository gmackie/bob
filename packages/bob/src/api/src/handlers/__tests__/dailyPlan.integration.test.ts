import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { eq } from "@bob/db";
import { makePgliteDb } from "@bob/db/client-pglite";
import {
  chatConversations,
  dailyPlans,
  notifications,
  projects,
  tenantMembers,
  tenants,
  user,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";

import {
  dailyPlanApprove,
  dailyPlanClose,
  dailyPlanGenerate,
  dailyPlanGet,
  runDailyPlanCron,
  runDailyReviewCron,
} from "../dailyPlan.js";

vi.mock("../../services/push/pushService.js", () => ({
  sendPushNotification: vi.fn(() => Promise.resolve(undefined)),
}));

/**
 * The whole day, end to end, on an in-memory database: the morning cron pulls
 * the BizPulse briefing and builds a plan, a person approves it in a new
 * order, work happens, the evening cron closes it with a review. Pins the
 * contract between the three pieces rather than any one of them.
 */
describe("daily plan loop", () => {
  let handle: PgliteDbHandle;
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333331";
  const ctx = {
    get db() {
      return handle.db as never;
    },
    userId: "user-1",
  };
  const today = "2026-10-01";
  const morning = new Date("2026-10-01T06:30:00.000Z");
  const evening = new Date("2026-10-01T21:30:00.000Z");

  const briefing = {
    briefing: { id: "brief-1", date: today, status: "ready" },
    startupNames: { "st-1": "Acme" },
    tasks: [
      {
        id: "t-1",
        startupId: "st-1",
        title: "Retry failed payments",
        description: "Three invoices bounced.",
        assignee: "agent",
        priority: "high",
        category: "billing",
        sourceRule: "retry_failed_payments",
        status: "pending",
        linkedUrl: null,
        sortOrder: 0,
      },
      {
        id: "t-2",
        startupId: "st-1",
        title: "Call the investor",
        description: null,
        assignee: "founder",
        priority: "high",
        category: null,
        sourceRule: null,
        status: "pending",
        linkedUrl: null,
        sortOrder: 1,
      },
    ],
  };
  const bizpulseFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ result: { data: { json: briefing } } })),
    );
  const bizpulse = {
    apiUrl: "https://bizpulse.test",
    apiKey: "biz_test",
    fetch: bizpulseFetch,
  };

  let queueA = "";
  let queueB = "";

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
    const db = handle.db;
    await db
      .insert(user)
      .values({ id: "user-1", name: "Owner", email: "owner@example.com" });
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Personal", slug: "personal" })
      .returning();
    if (!tenant) throw new Error("tenant");
    await db
      .insert(tenantMembers)
      .values({ tenantId: tenant.id, userId: "user-1", role: "owner" });
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: "user-1",
      tenantId: tenant.id,
      name: "Bob",
      slug: "bob",
    });
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId: "user-1", role: "owner" });
    await db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "Bob",
      key: "BOB",
      status: "active",
    });
    const [a, b] = await db
      .insert(workItems)
      .values([
        {
          ownerUserId: "user-1",
          workspaceId,
          projectId,
          sequenceNumber: 1,
          kind: "task",
          title: "Fix proxy cooldown",
          status: "todo",
          queueSortOrder: 40,
        },
        {
          ownerUserId: "user-1",
          workspaceId,
          projectId,
          sequenceNumber: 2,
          kind: "task",
          title: "Nodes cooldown column",
          status: "ready",
          queueSortOrder: 10,
        },
        {
          ownerUserId: "user-1",
          workspaceId,
          projectId,
          sequenceNumber: 3,
          kind: "task",
          title: "Already shipped",
          status: "done",
          queueSortOrder: 0,
        },
      ])
      .returning({ id: workItems.id });
    if (!a || !b) throw new Error("work item fixtures were not created");
    queueA = a.id;
    queueB = b.id;
  });

  afterAll(async () => handle.close());

  it("morning: pulls the briefing, files the agent task, plans the day, and tells the owner", async () => {
    const result = await runDailyPlanCron({
      db: handle.db as never,
      now: morning,
      hourUtc: 6,
      bizpulse,
    });
    expect(result.ran).toBe(true);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces?.[0]?.intake).toEqual([
      {
        provider: "bizpulse",
        pulled: 1,
        created: 1,
        reused: 0,
        skipped: 0,
        error: null,
      },
    ]);

    const plan = await dailyPlanGet(ctx, { workspaceId, planDate: today });
    expect(plan?.status).toBe("draft");
    // The intake task is planned ahead of the queue; the queue follows its own order.
    expect(plan?.items.map((i) => [i.title, i.source])).toEqual([
      ["Retry failed payments", "bizpulse"],
      ["Nodes cooldown column", "queue"],
      ["Fix proxy cooldown", "queue"],
    ]);
    expect(plan?.items[0]?.projectName).toBe("Acme");
    expect(plan?.items[0]?.identifier).toBe("ACME-4");
    expect(plan?.summary).toContain("3 items planned");

    const filed = await handle.db.query.workItems.findFirst({
      where: eq(workItems.externalProvider, "bizpulse"),
    });
    expect(filed?.status).toBe("todo");
    expect(filed?.externalId).toBe(
      "bizpulse:2026-10-01:st-1:retry_failed_payments:retry-failed-payments",
    );

    const pushed = await handle.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "daily_plan_ready"));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.url).toBe("/today");
  });

  it("morning, again: does not plan twice, and the briefing task is not filed twice", async () => {
    const again = await runDailyPlanCron({
      db: handle.db as never,
      now: morning,
      hourUtc: 6,
      bizpulse,
    });
    expect(again.workspaces).toHaveLength(0);
    const plans = await handle.db.select().from(dailyPlans);
    expect(plans).toHaveLength(1);

    // A manual rebuild of a draft is allowed and recognises the task already filed.
    const rebuilt = await dailyPlanGenerate(ctx, {
      workspaceId,
      planDate: today,
    });
    expect(rebuilt.intake).toEqual([]); // no BizPulse config in process.env here
    const filed = await handle.db
      .select()
      .from(workItems)
      .where(eq(workItems.externalProvider, "bizpulse"));
    expect(filed).toHaveLength(1);
  });

  it("approval writes the chosen order into the dispatch queue", async () => {
    const plan = await dailyPlanGet(ctx, { workspaceId, planDate: today });
    const intake = plan?.items.find((i) => i.title === "Retry failed payments");
    if (!plan || !intake) throw new Error("plan or intake item missing");
    const intakeId = intake.workItemId;
    // Put the queue items first, the intake task last.
    const reordered = [queueB, queueA, intakeId];
    const approved = await dailyPlanApprove(ctx, {
      planId: plan.id,
      workItemIds: reordered,
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByUserId).toBe("user-1");
    expect(approved.items.map((i) => i.workItemId)).toEqual(reordered);

    const rows = await handle.db
      .select({ id: workItems.id, order: workItems.queueSortOrder })
      .from(workItems)
      .where(eq(workItems.workspaceId, workspaceId));
    const orderOf = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(orderOf[queueB]).toBe(0);
    expect(orderOf[queueA]).toBe(1);
    expect(orderOf[intakeId]).toBe(2);

    await expect(
      dailyPlanGenerate(ctx, { workspaceId, planDate: today }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("evening: closes the plan with what actually happened and tells the owner", async () => {
    // The day happens: one item finished, one ran and is in review, one never started.
    await handle.db
      .update(workItems)
      .set({ status: "done" })
      .where(eq(workItems.id, queueB));
    await handle.db
      .update(workItems)
      .set({ status: "in_review" })
      .where(eq(workItems.id, queueA));
    await handle.db.insert(chatConversations).values([
      {
        userId: "user-1",
        title: "Fix proxy cooldown",
        agentType: "claude",
        sessionType: "execution",
        status: "completed",
        workItemId: queueA,
        createdAt: "2026-10-01T10:00:00.000Z",
      },
      {
        userId: "user-1",
        title: "Unplanned poke",
        agentType: "codex",
        sessionType: "execution",
        status: "failed",
        planningWorkspaceId: workspaceId,
        createdAt: "2026-10-01T11:00:00.000Z",
      },
    ]);

    const early = await runDailyReviewCron({
      db: handle.db as never,
      now: morning,
      hourUtc: 21,
    });
    expect(early.ran).toBe(false);

    const result = await runDailyReviewCron({
      db: handle.db as never,
      now: evening,
      hourUtc: 21,
    });
    expect(result.workspaces).toHaveLength(1);

    const closed = await dailyPlanGet(ctx, { workspaceId, planDate: today });
    if (!closed) throw new Error("plan missing after close");
    expect(closed.status).toBe("closed");
    expect(closed.review?.counts).toMatchObject({
      done: 1,
      in_review: 1,
      not_started: 1,
    });
    expect(
      closed.review?.items.find((i) => i.workItemId === queueA)?.sessionIds,
    ).toHaveLength(1);
    expect(closed.review?.unplannedSessionIds).toHaveLength(1);
    expect(closed.review?.sessionsFailed).toBe(1);
    expect(closed.reviewSummary?.split("\n")[0]).toBe(
      "2 of 3 planned items finished (1 waiting on your review); 0 still running, 0 blocked, 0 failed, 1 not started.",
    );

    const pushed = await handle.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "daily_review_ready"));
    expect(pushed).toHaveLength(1);

    // Closing again is idempotent through the RPC path.
    const again = await dailyPlanClose(ctx, { planId: closed.id });
    expect(again.closedAt).toBe(closed.closedAt);
    await expect(
      dailyPlanApprove(ctx, { planId: closed.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
