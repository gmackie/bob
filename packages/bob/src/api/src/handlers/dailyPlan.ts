/**
 * The daily loop: intake in the morning, a plan to approve, a review at night.
 *
 * Before this, work reached Bob's queue from the tracker and OODA, the loop
 * drained it from the top, and once a day a digest counted what happened.
 * Nothing stated what a day was for, nothing pulled the agent tasks BizPulse
 * generates each morning, and nothing compared intent to outcome. This adds
 * the three pieces and the two pushes that announce them.
 *
 * Cron entry points (`runDailyPlanCron`, `runDailyReviewCron`) never throw;
 * RPC entry points (`dailyPlanGet` and friends) take a HandlerContext and
 * throw TRPCError like every other handler.
 */

import { TRPCError } from "@trpc/server";

import type { Db } from "@bob/db/client";
import type {
  DailyPlanIntake,
  DailyPlanItem,
  DailyPlanStatus,
} from "@bob/db/schema";
import { and, desc, eq, gte, inArray, or, sql } from "@bob/db";
import { db as defaultDb } from "@bob/db/client";
import {
  chatConversations,
  dailyPlans,
  projects,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";

import type { PlanCandidate } from "../services/dailyPlan/buildDailyPlan.js";
import type { BizPulseClientOptions } from "../services/intake/bizpulseIntake.js";
import type { HandlerContext } from "./context.js";
import { buildDailyPlan } from "../services/dailyPlan/buildDailyPlan.js";
import {
  renderReviewSummary,
  reviewDailyPlan,
} from "../services/dailyPlan/reviewDailyPlan.js";
import {
  BIZPULSE_PROVIDER,
  fetchBizPulseTodayBriefing,
  mapBriefingToIntakeTasks,
  normalizeTitle,
} from "../services/intake/bizpulseIntake.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyPlanRecord {
  id: string;
  workspaceId: string;
  planDate: string;
  status: DailyPlanStatus;
  summary: string;
  items: (DailyPlanItem & { currentStatus: string | null })[];
  intake: DailyPlanIntake[];
  review: (typeof dailyPlans.$inferSelect)["review"];
  reviewSummary: string | null;
  capacity: number;
  createdAt: string;
  approvedAt: string | null;
  approvedByUserId: string | null;
  closedAt: string | null;
}

export type BizPulseIntakeConfig = BizPulseClientOptions;

export interface DailyPlanCronOptions {
  now?: Date;
  /** First cron tick at or after this UTC hour builds the plan. */
  hourUtc?: number;
  /** Build even if a plan already exists for today (rebuilds drafts only). */
  force?: boolean;
  dailyCap?: number;
  bizpulse?: BizPulseIntakeConfig | null;
  db?: Db;
}

export interface DailyPlanCronResult {
  ran: boolean;
  reason?: string;
  date?: string;
  workspaces?: {
    workspaceId: string;
    planId: string;
    items: number;
    intake: DailyPlanIntake[];
  }[];
}

const CLOSED_STATUSES = ["done", "cancelled", "canceled", "failed"];
const PLANNABLE_STATUSES = ["todo", "ready", "blocked", "in_progress"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function dayStartIso(planDate: string): string {
  return `${planDate}T00:00:00.000Z`;
}

async function assertWorkspaceAccess(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });
  if (membership) return;
  const owned = await db.query.workspaces.findFirst({
    where: and(
      eq(workspaces.id, workspaceId),
      eq(workspaces.ownerUserId, userId),
    ),
    columns: { id: true },
  });
  if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
}

async function workspaceOwnerUserId(
  db: Db,
  workspaceId: string,
): Promise<string | null> {
  const member = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.workspaceId, workspaceId),
    columns: { userId: true },
    orderBy: (m, { asc }) => [asc(m.joinedAt)],
  });
  if (member) return member.userId;
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { ownerUserId: true },
  });
  return ws?.ownerUserId ?? null;
}

async function workspaceMemberIds(
  db: Db,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const ids = new Set(rows.map((r) => r.userId));
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { ownerUserId: true },
  });
  if (ws) ids.add(ws.ownerUserId);
  return [...ids];
}

function deriveProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [first] = words;
  if (words.length >= 2)
    return words
      .map((w) => w[0])
      .join("")
      .slice(0, 8);
  return (first ?? "PULSE").slice(0, 6);
}

/** Find or create the Bob project a BizPulse startup's tasks land in. */
async function ensureIntakeProject(
  db: Db,
  workspaceId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const existing = await db.query.projects.findFirst({
    where: and(
      eq(projects.workspaceId, workspaceId),
      eq(projects.name, name.slice(0, 128)),
    ),
    columns: { id: true, name: true },
  });
  if (existing) return existing;

  const base = deriveProjectKey(name);
  const taken = new Set(
    (
      await db
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId))
    ).map((r) => r.key),
  );
  let key = base;
  for (let n = 2; taken.has(key) && n < 100; n++)
    key = `${base}${n}`.slice(0, 16);

  const [created] = await db
    .insert(projects)
    .values({
      workspaceId,
      name: name.slice(0, 128),
      key,
      status: "active",
      planningProvider: "internal",
      automationSettings: { autoDispatch: false },
    })
    .returning({ id: projects.id, name: projects.name });
  if (!created) throw new Error("failed to create intake project");
  return created;
}

async function nextSequenceNumber(
  db: Db,
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max(${workItems.sequenceNumber}), 0)::int`,
    })
    .from(workItems)
    .where(eq(workItems.workspaceId, workspaceId));
  return Number(row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/**
 * Pull today's BizPulse briefing into the workspace. Returns what it did and
 * the ids of every work item it created or recognised, so the plan can mark
 * them as today's intake.
 */
export async function runBizPulseIntake(
  db: Db,
  input: {
    workspaceId: string;
    planDate: string;
    config: BizPulseIntakeConfig;
  },
): Promise<{ intake: DailyPlanIntake; touchedWorkItemIds: string[] }> {
  const intake: DailyPlanIntake = {
    provider: BIZPULSE_PROVIDER,
    pulled: 0,
    created: 0,
    reused: 0,
    skipped: 0,
    error: null,
  };
  const touched: string[] = [];

  let tasks;
  try {
    const briefing = await fetchBizPulseTodayBriefing(input.config);
    tasks = mapBriefingToIntakeTasks(briefing, input.planDate);
  } catch (error) {
    intake.error = error instanceof Error ? error.message : String(error);
    return { intake, touchedWorkItemIds: touched };
  }
  intake.pulled = tasks.length;
  if (tasks.length === 0) return { intake, touchedWorkItemIds: touched };

  const owner = await workspaceOwnerUserId(db, input.workspaceId);
  if (!owner) {
    intake.error = "workspace has no owner to file work items as";
    return { intake, touchedWorkItemIds: touched };
  }

  // Open BizPulse items in the workspace, for title-based reuse of recurring
  // rules ("Retry failed payments" fires most mornings).
  const open = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      projectId: workItems.projectId,
      sourceMetadata: workItems.sourceMetadata,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.workspaceId, input.workspaceId),
        eq(workItems.externalProvider, BIZPULSE_PROVIDER),
        sql`${workItems.status} not in (${sql.join(
          CLOSED_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
    );
  const openByTitle = new Map(
    open.map((row) => [
      `${row.projectId ?? ""}::${normalizeTitle(row.title)}`,
      row,
    ]),
  );

  for (const task of tasks) {
    const existing = await db.query.workItems.findFirst({
      where: and(
        eq(workItems.externalProvider, BIZPULSE_PROVIDER),
        eq(workItems.externalId, task.externalId),
      ),
      columns: { id: true },
    });
    if (existing) {
      intake.skipped += 1;
      touched.push(existing.id);
      continue;
    }

    const project = await ensureIntakeProject(
      db,
      input.workspaceId,
      task.projectName,
    );
    const recurring = openByTitle.get(
      `${project.id}::${normalizeTitle(task.title)}`,
    );
    if (recurring) {
      const previous = Array.isArray(recurring.sourceMetadata.recurrences)
        ? (recurring.sourceMetadata.recurrences as unknown[])
        : [];
      await db
        .update(workItems)
        .set({
          sourceMetadata: {
            ...recurring.sourceMetadata,
            recurrences: [
              ...previous,
              {
                provider: BIZPULSE_PROVIDER,
                id: task.externalId,
                seenAt: new Date().toISOString(),
              },
            ],
          },
        })
        .where(eq(workItems.id, recurring.id));
      intake.reused += 1;
      touched.push(recurring.id);
      continue;
    }

    const [created] = await db
      .insert(workItems)
      .values({
        ownerUserId: owner,
        workspaceId: input.workspaceId,
        projectId: project.id,
        kind: "task",
        title: task.title,
        description: task.description,
        status: "todo",
        sequenceNumber: await nextSequenceNumber(db, input.workspaceId),
        queueSortOrder: task.queueSortOrder,
        externalId: task.externalId,
        externalProvider: BIZPULSE_PROVIDER,
        externalUrl: task.externalUrl,
        sourceMetadata: task.sourceMetadata,
      })
      .returning({ id: workItems.id, title: workItems.title });
    if (created) {
      intake.created += 1;
      touched.push(created.id);
      openByTitle.set(`${project.id}::${normalizeTitle(created.title)}`, {
        id: created.id,
        title: created.title,
        projectId: project.id,
        sourceMetadata: task.sourceMetadata,
      });
    }
  }

  return { intake, touchedWorkItemIds: touched };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

async function loadCandidates(
  db: Db,
  workspaceId: string,
): Promise<(PlanCandidate & { status: string })[]> {
  const rows = await db
    .select({
      workItemId: workItems.id,
      title: workItems.title,
      sequenceNumber: workItems.sequenceNumber,
      projectId: workItems.projectId,
      projectName: projects.name,
      projectKey: projects.key,
      status: workItems.status,
      queueSortOrder: workItems.queueSortOrder,
      createdAt: workItems.createdAt,
    })
    .from(workItems)
    .leftJoin(projects, eq(projects.id, workItems.projectId))
    .where(
      and(
        eq(workItems.workspaceId, workspaceId),
        eq(workItems.kind, "task"),
        inArray(workItems.status, PLANNABLE_STATUSES),
      ),
    );
  return rows.map((row) => ({
    workItemId: row.workItemId,
    title: row.title,
    identifier:
      row.projectKey && row.sequenceNumber
        ? `${row.projectKey}-${row.sequenceNumber}`
        : null,
    projectId: row.projectId,
    projectName: row.projectName,
    status: row.status,
    queueSortOrder: row.queueSortOrder,
    createdAt: row.createdAt,
  }));
}

async function dailyCapacity(db: Db, fallback: number): Promise<number> {
  const cfg = await db.query.autoDrainConfig.findFirst({
    columns: { dailyCap: true },
  });
  return cfg?.dailyCap ?? fallback;
}

async function previousPlanLeftovers(
  db: Db,
  workspaceId: string,
  planDate: string,
): Promise<Set<string>> {
  const previous = await db.query.dailyPlans.findFirst({
    where: and(
      eq(dailyPlans.workspaceId, workspaceId),
      sql`${dailyPlans.planDate} < ${planDate}`,
    ),
    orderBy: [desc(dailyPlans.planDate)],
    columns: { items: true, review: true },
  });
  if (!previous) return new Set();
  const reviewed = previous.review?.items ?? [];
  const finished = new Set(
    reviewed
      .filter((i) => i.outcome === "done" || i.outcome === "in_review")
      .map((i) => i.workItemId),
  );
  return new Set(
    previous.items.map((i) => i.workItemId).filter((id) => !finished.has(id)),
  );
}

/**
 * Build or rebuild the day's plan for one workspace. An approved or closed
 * plan is never rebuilt: a decision was made, and the review has to compare
 * against it.
 */
export async function generateDailyPlanForWorkspace(
  db: Db,
  input: {
    workspaceId: string;
    planDate: string;
    dailyCap?: number;
    bizpulse?: BizPulseIntakeConfig | null;
  },
): Promise<{ plan: typeof dailyPlans.$inferSelect; created: boolean }> {
  const existing = await db.query.dailyPlans.findFirst({
    where: and(
      eq(dailyPlans.workspaceId, input.workspaceId),
      eq(dailyPlans.planDate, input.planDate),
    ),
  });
  if (existing && existing.status !== "draft")
    return { plan: existing, created: false };

  const intakes: DailyPlanIntake[] = [];
  const touched = new Set<string>();
  if (input.bizpulse) {
    const result = await runBizPulseIntake(db, {
      workspaceId: input.workspaceId,
      planDate: input.planDate,
      config: input.bizpulse,
    });
    intakes.push(result.intake);
    for (const id of result.touchedWorkItemIds) touched.add(id);
  }

  const [candidates, capacity, carried] = await Promise.all([
    loadCandidates(db, input.workspaceId),
    dailyCapacity(db, input.dailyCap ?? 20),
    previousPlanLeftovers(db, input.workspaceId, input.planDate),
  ]);
  const enriched = candidates.map((c) => ({
    ...c,
    intakeProvider: touched.has(c.workItemId) ? BIZPULSE_PROVIDER : null,
    carriedOver: carried.has(c.workItemId),
  }));
  const built = buildDailyPlan({
    planDate: input.planDate,
    capacity,
    inFlight: enriched.filter((c) => c.status === "in_progress"),
    candidates: enriched.filter((c) => c.status !== "in_progress"),
  });

  const values = {
    workspaceId: input.workspaceId,
    planDate: input.planDate,
    status: "draft" as const,
    summary: built.summary,
    items: built.items,
    intake: intakes,
    capacity,
  };
  if (existing) {
    const [updated] = await db
      .update(dailyPlans)
      .set(values)
      .where(eq(dailyPlans.id, existing.id))
      .returning();
    if (!updated) throw new Error("failed to update daily plan");
    return { plan: updated, created: false };
  }
  const [inserted] = await db.insert(dailyPlans).values(values).returning();
  if (!inserted) throw new Error("failed to insert daily plan");
  return { plan: inserted, created: true };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function closeDailyPlanRow(
  db: Db,
  plan: typeof dailyPlans.$inferSelect,
  now: Date,
): Promise<typeof dailyPlans.$inferSelect> {
  const ids = plan.items.map((i) => i.workItemId);
  const current = ids.length
    ? await db
        .select({ workItemId: workItems.id, status: workItems.status })
        .from(workItems)
        .where(inArray(workItems.id, ids))
    : [];

  const sessions = await db
    .select({
      sessionId: chatConversations.id,
      workItemId: chatConversations.workItemId,
      status: chatConversations.status,
    })
    .from(chatConversations)
    .leftJoin(workItems, eq(workItems.id, chatConversations.workItemId))
    .where(
      and(
        eq(chatConversations.sessionType, "execution"),
        gte(chatConversations.createdAt, dayStartIso(plan.planDate)),
        or(
          eq(workItems.workspaceId, plan.workspaceId),
          eq(chatConversations.planningWorkspaceId, plan.workspaceId),
        ),
      ),
    );

  const review = reviewDailyPlan({
    items: plan.items,
    workItems: current,
    sessions,
    now,
  });
  const [closed] = await db
    .update(dailyPlans)
    .set({
      status: "closed",
      review,
      reviewSummary: renderReviewSummary(plan.planDate, review),
      closedAt: now.toISOString(),
    })
    .where(eq(dailyPlans.id, plan.id))
    .returning();
  if (!closed) throw new Error("failed to close daily plan");
  return closed;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function notifyWorkspace(
  db: Db,
  workspaceId: string,
  input: {
    type: "daily_plan_ready" | "daily_review_ready";
    title: string;
    body: string;
    url: string;
  },
): Promise<void> {
  const { createInAppNotification } =
    await import("../services/notifications/notificationService.js");
  for (const userId of await workspaceMemberIds(db, workspaceId)) {
    try {
      await createInAppNotification(db, {
        userId,
        type: input.type,
        title: input.title,
        body: input.body.slice(0, 2000),
        url: input.url,
      });
    } catch (error) {
      console.error(
        `[daily-plan] notify ${input.type} failed for ${userId}:`,
        error,
      );
    }
  }
}

function planHeadline(plan: typeof dailyPlans.$inferSelect): string {
  const first = plan.summary.split("\n")[0] ?? "";
  return first || `${plan.items.length} items planned`;
}

// ---------------------------------------------------------------------------
// Cron entry points
// ---------------------------------------------------------------------------

/** Morning: build today's plan for every workspace that has none yet. */
export async function runDailyPlanCron(
  opts: DailyPlanCronOptions = {},
): Promise<DailyPlanCronResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const hour = opts.hourUtc ?? 6;
  const today = utcDate(now);
  if (!opts.force && now.getUTCHours() < hour)
    return { ran: false, reason: "before plan hour" };

  const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
  const results: NonNullable<DailyPlanCronResult["workspaces"]> = [];
  for (const ws of allWorkspaces) {
    try {
      const existing = await db.query.dailyPlans.findFirst({
        where: and(
          eq(dailyPlans.workspaceId, ws.id),
          eq(dailyPlans.planDate, today),
        ),
        columns: { id: true },
      });
      if (existing && !opts.force) continue;

      const { plan, created } = await generateDailyPlanForWorkspace(db, {
        workspaceId: ws.id,
        planDate: today,
        dailyCap: opts.dailyCap,
        bizpulse: opts.bizpulse ?? null,
      });
      results.push({
        workspaceId: ws.id,
        planId: plan.id,
        items: plan.items.length,
        intake: plan.intake,
      });
      if (created) {
        await notifyWorkspace(db, ws.id, {
          type: "daily_plan_ready",
          title: `Today's plan is ready — ${today}`,
          body: planHeadline(plan),
          url: "/today",
        });
      }
    } catch (error) {
      console.error(`[daily-plan] workspace ${ws.id} failed:`, error);
    }
  }
  return { ran: true, date: today, workspaces: results };
}

/** Evening: close every open plan for today with a review. */
export async function runDailyReviewCron(
  opts: { now?: Date; hourUtc?: number; force?: boolean; db?: Db } = {},
): Promise<DailyPlanCronResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const hour = opts.hourUtc ?? 21;
  const today = utcDate(now);
  if (!opts.force && now.getUTCHours() < hour)
    return { ran: false, reason: "before review hour" };

  const open = await db
    .select()
    .from(dailyPlans)
    .where(
      and(
        eq(dailyPlans.planDate, today),
        sql`${dailyPlans.status} <> 'closed'`,
      ),
    );
  const results: NonNullable<DailyPlanCronResult["workspaces"]> = [];
  for (const plan of open) {
    try {
      const closed = await closeDailyPlanRow(db, plan, now);
      results.push({
        workspaceId: plan.workspaceId,
        planId: plan.id,
        items: plan.items.length,
        intake: plan.intake,
      });
      await notifyWorkspace(db, plan.workspaceId, {
        type: "daily_review_ready",
        title: `Today's review — ${today}`,
        body: (closed.reviewSummary ?? "").split("\n")[0] ?? "",
        url: "/today",
      });
    } catch (error) {
      console.error(`[daily-review] plan ${plan.id} failed:`, error);
    }
  }
  return { ran: true, date: today, workspaces: results };
}

// ---------------------------------------------------------------------------
// RPC handlers
// ---------------------------------------------------------------------------

async function toRecord(
  db: Db,
  plan: typeof dailyPlans.$inferSelect,
): Promise<DailyPlanRecord> {
  const ids = plan.items.map((i) => i.workItemId);
  const current = ids.length
    ? await db
        .select({ id: workItems.id, status: workItems.status })
        .from(workItems)
        .where(inArray(workItems.id, ids))
    : [];
  const statusById = new Map(current.map((r) => [r.id, r.status]));
  return {
    id: plan.id,
    workspaceId: plan.workspaceId,
    planDate: plan.planDate,
    status: plan.status as DailyPlanStatus,
    summary: plan.summary,
    items: plan.items.map((item) => ({
      ...item,
      currentStatus: statusById.get(item.workItemId) ?? null,
    })),
    intake: plan.intake,
    review: plan.review ?? null,
    reviewSummary: plan.reviewSummary ?? null,
    capacity: plan.capacity,
    createdAt: plan.createdAt,
    approvedAt: plan.approvedAt ?? null,
    approvedByUserId: plan.approvedByUserId ?? null,
    closedAt: plan.closedAt ?? null,
  };
}

function bizpulseConfigFromEnv(): BizPulseIntakeConfig | null {
  const apiUrl = process.env.BOB_BIZPULSE_API_URL?.trim();
  const apiKey = process.env.BOB_BIZPULSE_API_KEY?.trim();
  return apiUrl && apiKey ? { apiUrl, apiKey } : null;
}

export async function dailyPlanGet(
  ctx: HandlerContext,
  input: { workspaceId: string; planDate?: string },
): Promise<DailyPlanRecord | null> {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  const planDate = input.planDate ?? utcDate(new Date());
  const plan = await ctx.db.query.dailyPlans.findFirst({
    where: and(
      eq(dailyPlans.workspaceId, input.workspaceId),
      eq(dailyPlans.planDate, planDate),
    ),
  });
  return plan ? toRecord(ctx.db, plan) : null;
}

export async function dailyPlanList(
  ctx: HandlerContext,
  input: { workspaceId: string; limit?: number },
): Promise<DailyPlanRecord[]> {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  const rows = await ctx.db
    .select()
    .from(dailyPlans)
    .where(eq(dailyPlans.workspaceId, input.workspaceId))
    .orderBy(desc(dailyPlans.planDate))
    .limit(Math.min(Math.max(input.limit ?? 14, 1), 60));
  return Promise.all(rows.map((row) => toRecord(ctx.db, row)));
}

export async function dailyPlanGenerate(
  ctx: HandlerContext,
  input: { workspaceId: string; planDate?: string },
): Promise<DailyPlanRecord> {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  const planDate = input.planDate ?? utcDate(new Date());
  const existing = await ctx.db.query.dailyPlans.findFirst({
    where: and(
      eq(dailyPlans.workspaceId, input.workspaceId),
      eq(dailyPlans.planDate, planDate),
    ),
    columns: { status: true },
  });
  if (existing && existing.status !== "draft") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Plan for ${planDate} is already ${existing.status}`,
    });
  }
  const { plan } = await generateDailyPlanForWorkspace(ctx.db, {
    workspaceId: input.workspaceId,
    planDate,
    bizpulse: bizpulseConfigFromEnv(),
  });
  return toRecord(ctx.db, plan);
}

async function loadPlanForUser(
  ctx: HandlerContext,
  planId: string,
): Promise<typeof dailyPlans.$inferSelect> {
  const plan = await ctx.db.query.dailyPlans.findFirst({
    where: eq(dailyPlans.id, planId),
  });
  if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
  await assertWorkspaceAccess(ctx.db, ctx.userId, plan.workspaceId);
  return plan;
}

/**
 * Approve the plan, optionally in a new order. The order becomes the dispatch
 * order: planned items get queueSortOrder 0..n so auto-drain works them in
 * the order a person chose, ahead of everything that was not planned.
 */
export async function dailyPlanApprove(
  ctx: HandlerContext,
  input: { planId: string; workItemIds?: readonly string[] },
): Promise<DailyPlanRecord> {
  const plan = await loadPlanForUser(ctx, input.planId);
  if (plan.status === "closed") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A closed plan cannot be approved",
    });
  }

  let items = [...plan.items].sort((a, b) => a.order - b.order);
  if (input.workItemIds) {
    // A client may repeat or omit ids; the plan keeps every item exactly once.
    const byId = new Map(items.map((i) => [i.workItemId, i]));
    const seen = new Set<string>();
    const ordered: DailyPlanItem[] = [];
    for (const id of input.workItemIds) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        ordered.push(item);
      }
    }
    const rest = items.filter((i) => !seen.has(i.workItemId));
    items = [...ordered, ...rest];
  }
  items = items.map((item, order) => ({ ...item, order }));

  const now = new Date().toISOString();
  for (const item of items) {
    await ctx.db
      .update(workItems)
      .set({ queueSortOrder: item.order })
      .where(
        and(
          eq(workItems.id, item.workItemId),
          inArray(workItems.status, ["todo", "ready", "blocked"]),
        ),
      );
  }
  const [updated] = await ctx.db
    .update(dailyPlans)
    .set({
      status: "approved",
      items,
      approvedAt: now,
      approvedByUserId: ctx.userId,
    })
    .where(eq(dailyPlans.id, plan.id))
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
  return toRecord(ctx.db, updated);
}

export async function dailyPlanClose(
  ctx: HandlerContext,
  input: { planId: string },
): Promise<DailyPlanRecord> {
  const plan = await loadPlanForUser(ctx, input.planId);
  const closed =
    plan.status === "closed"
      ? plan
      : await closeDailyPlanRow(ctx.db, plan, new Date());
  return toRecord(ctx.db, closed);
}
