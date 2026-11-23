/**
 * BOB-76 Phase 5: spend surplus budget down the ladder.
 *
 * - groom / discovery / bizpulse start planning sessions (always Claude) with
 *   `budgetTier` in the launch context. The gateway keeps their drafts as
 *   proposals: nothing reaches the tracker until a human commits the plan.
 * - pull-forward promotes the oldest backlog items to todo; the normal
 *   delivery path dispatches them on a later tick, under the same budget.
 *
 * Every tier is bounded by its allocation and deduplicated (an item is groomed
 * once; a project gets at most one discovery and one BizPulse session a week).
 */
import { and, asc, eq, gte, inArray, isNotNull, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, projects, repositories, workItems, workspaces } from "@bob/db/schema";
import type { BudgetTier } from "@bob/ws";

import { planSessionCreate, planSessionStart } from "../../handlers/planSession.js";

export const TIER_NOTES: Record<Exclude<BudgetTier, "delivery" | "pull-forward">, string> = {
  groom:
    "Budget surplus · groom. Read this backlog issue and the repository. Propose a sharper spec, acceptance criteria, a size estimate (S/M/L with rough agent-hours) and, if it is too big for one agent run, a split into smaller issues. Output drafts only; a human approves before anything changes in the tracker.",
  discovery:
    "Budget surplus · discovery. Survey this repository for valuable work nobody has filed: failing or flaky CI, missing tests around risky code, TODO/FIXME debt, outdated dependencies with known problems, small UX papercuts. Propose at most 5 new issues as drafts, each with acceptance criteria. Do not change code.",
  bizpulse:
    "Budget surplus · BizPulse. For the venture behind this project, review growth bottlenecks, compliance gaps and open research questions using read-only sources (the repository, public information, and the pulse CLI in --json mode where available). Propose at most 3 issues as drafts with their expected impact. Take no external actions.",
};

const WEEK_MS = 7 * 86_400_000;

export interface SurplusDemand {
  groom: number;
  "pull-forward": number;
  discovery: number;
  bizpulse: number;
}

async function groomCandidates(limit: number) {
  return db
    .select({ id: workItems.id, title: workItems.title, kind: workItems.kind, projectId: workItems.projectId, workspaceId: workItems.workspaceId, ownerUserId: workItems.ownerUserId, externalId: workItems.externalId, sourceMetadata: workItems.sourceMetadata })
    .from(workItems)
    .where(and(eq(workItems.status, "backlog"), eq(workItems.kind, "task"), isNotNull(workItems.projectId), isNotNull(workItems.workspaceId), sql`${workItems.sourceMetadata}->>'budgetGroomedAt' is null`))
    .orderBy(asc(workItems.createdAt))
    .limit(limit);
}

async function pullForwardCandidates(limit: number) {
  return db
    .select({ id: workItems.id, sourceMetadata: workItems.sourceMetadata })
    .from(workItems)
    .where(and(eq(workItems.status, "backlog"), eq(workItems.kind, "task"), sql`${workItems.sourceMetadata}->>'budgetGroomedAt' is not null`))
    .orderBy(asc(workItems.queueSortOrder), asc(workItems.createdAt))
    .limit(limit);
}

/** Projects with a repository to plan in, and their workspace owner. */
async function plannableProjects(onlyBizPulse: boolean) {
  const rows = await db
    .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId, ownerUserId: workspaces.ownerUserId, path: repositories.path })
    .from(projects)
    .innerJoin(repositories, eq(repositories.planningProjectId, projects.id))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId));
  if (!onlyBizPulse) return rows;
  const ventures = await db
    .selectDistinct({ projectId: workItems.projectId })
    .from(workItems)
    .where(and(eq(workItems.externalProvider, "bizpulse"), isNotNull(workItems.projectId)));
  const ids = new Set(ventures.map((v) => v.projectId));
  return rows.filter((r) => ids.has(r.id));
}

async function recentlyPlanned(tier: BudgetTier, titles: string[], now: Date): Promise<Set<string>> {
  if (!titles.length) return new Set();
  const rows = await db
    .select({ title: chatConversations.title })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.sessionType, "planning"),
        inArray(chatConversations.title, titles),
        gte(chatConversations.createdAt, new Date(now.getTime() - WEEK_MS).toISOString()),
        sql`${chatConversations.planningLaunchContext}->>'budgetTier' = ${tier}`,
      ),
    );
  return new Set(rows.map((r) => r.title ?? ""));
}

/** How much work each surplus tier has right now (used for allocation and the ladder display). */
export async function surplusDemand(now = new Date()): Promise<SurplusDemand> {
  const [groom, pull, all, ventures] = await Promise.all([groomCandidates(50), pullForwardCandidates(50), plannableProjects(false), plannableProjects(true)]);
  const [discovered, bizpulsed] = await Promise.all([
    recentlyPlanned("discovery", all.map((p) => `Discovery · ${p.name}`), now),
    recentlyPlanned("bizpulse", ventures.map((p) => `BizPulse · ${p.name}`), now),
  ]);
  return {
    groom: groom.length,
    "pull-forward": pull.length,
    discovery: all.filter((p) => !discovered.has(`Discovery · ${p.name}`)).length,
    bizpulse: ventures.filter((p) => !bizpulsed.has(`BizPulse · ${p.name}`)).length,
  };
}

async function startPlanning(input: {
  tier: Exclude<BudgetTier, "delivery" | "pull-forward">;
  ownerUserId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  title: string;
  intent: "shape" | "breakdown";
  workItem?: { id: string; identifier: string; title: string; kind: string };
}): Promise<string> {
  const ctx = { db, userId: input.ownerUserId } as Parameters<typeof planSessionCreate>[0];
  const session = await planSessionCreate(ctx, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title: input.title,
    ...(input.workItem ? { workItemId: input.workItem.id } : {}),
  });
  await planSessionStart(ctx, {
    sessionId: session.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectName: input.projectName,
    workingDirectory: session.workingDirectory ?? "/",
    launchContext: {
      intent: input.intent,
      notes: TIER_NOTES[input.tier],
      ...(input.workItem ? { workItem: input.workItem } : {}),
      selectedRepoSources: [],
      attachedFiles: [],
      budgetTier: input.tier,
    },
  });
  return session.id;
}

export interface SurplusOutcome {
  tier: BudgetTier;
  ref: string;
}

/** Spend an allocation. Each start is independent; one failure does not stop the rest. */
export async function runSurplusTiers(allocation: Partial<Record<BudgetTier, number>>, now = new Date()): Promise<SurplusOutcome[]> {
  const out: SurplusOutcome[] = [];
  const log = (tier: BudgetTier, error: unknown) => console.warn(`[budget] ${tier} start failed:`, error instanceof Error ? error.message : error);

  const groomN = allocation.groom ?? 0;
  if (groomN > 0) {
    const items = await groomCandidates(groomN);
    const names = new Map((await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, items.map((i) => i.projectId ?? "")))).map((p) => [p.id, p.name]));
    for (const item of items) {
      if (!item.projectId || !item.workspaceId) continue;
      try {
        const ref = await startPlanning({
          tier: "groom",
          ownerUserId: item.ownerUserId,
          workspaceId: item.workspaceId,
          projectId: item.projectId,
          projectName: names.get(item.projectId) ?? "Project",
          title: `Groom · ${item.title}`.slice(0, 200),
          intent: "breakdown",
          workItem: { id: item.id, identifier: item.externalId ?? item.id.slice(0, 8), title: item.title, kind: item.kind },
        });
        await db.update(workItems).set({ sourceMetadata: { ...item.sourceMetadata, budgetGroomedAt: now.toISOString() } }).where(eq(workItems.id, item.id));
        out.push({ tier: "groom", ref });
      } catch (error) {
        log("groom", error);
      }
    }
  }

  const pullN = allocation["pull-forward"] ?? 0;
  if (pullN > 0) {
    // Only items that have had a grooming pass are pulled forward; the rest wait to be groomed first.
    for (const item of await pullForwardCandidates(pullN)) {
      const moved = await db
        .update(workItems)
        .set({ status: "todo", sourceMetadata: { ...item.sourceMetadata, budgetPulledForwardAt: now.toISOString() } })
        .where(and(eq(workItems.id, item.id), eq(workItems.status, "backlog")))
        .returning({ id: workItems.id });
      if (moved.length) out.push({ tier: "pull-forward", ref: item.id });
    }
  }

  for (const tier of ["discovery", "bizpulse"] as const) {
    const n = allocation[tier] ?? 0;
    if (n <= 0) continue;
    const label = tier === "discovery" ? "Discovery" : "BizPulse";
    const candidates = await plannableProjects(tier === "bizpulse");
    const done = await recentlyPlanned(tier, candidates.map((p) => `${label} · ${p.name}`), now);
    for (const project of candidates.filter((p) => !done.has(`${label} · ${p.name}`)).slice(0, n)) {
      try {
        out.push({
          tier,
          ref: await startPlanning({ tier, ownerUserId: project.ownerUserId, workspaceId: project.workspaceId, projectId: project.id, projectName: project.name, title: `${label} · ${project.name}`, intent: "shape" }),
        });
      } catch (error) {
        log(tier, error);
      }
    }
  }
  return out;
}

