import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray } from "@bob/db";
import {
  chatConversations,
  planDraftDependencies,
  planDrafts,
  projects,
  workItems,
} from "@bob/db/schema";

import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "../services/integrations/planningRemoteConfig";
import { protectedProcedure } from "../trpc";

export const planSessionRouter = {
  /** Create a new planning session. */
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        workingDirectory: z.string().optional(),
        title: z.string().max(256).optional(),
        workItemId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If workItemId is provided, look up workspace/project from the work item
      let resolvedWorkItemId = input.workItemId ?? null;

      if (input.workItemId && (!input.workspaceId || !input.projectId)) {
        const wi = await ctx.db.query.workItems.findFirst({
          where: eq(workItems.id, input.workItemId),
        });
        if (!wi) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Work item not found",
          });
        }
        resolvedWorkItemId = wi.id;
      }

      const [session] = await ctx.db
        .insert(chatConversations)
        .values({
          userId: ctx.session.user.id,
          workingDirectory: input.workingDirectory ?? "/",
          agentType: "claude",
          sessionType: "planning",
          title: input.title ?? "Planning session",
          status: "provisioning",
          workItemId: resolvedWorkItemId,
        })
        .returning();

      return session!;
    }),

  /** Start a planning session on the gateway. */
  start: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        projectName: z.string(),
        workingDirectory: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { startPlanningSession } = await import(
        "@bob/execution/planning/startPlanningSession"
      );

      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        columns: { automationSettings: true },
      });
      const projectAutomation =
        (project?.automationSettings as { reactFrontend?: boolean } | undefined) ??
        undefined;

      return startPlanningSession({
        userId: ctx.session.user.id,
        ...input,
        reactFrontend: Boolean(projectAutomation?.reactFrontend),
      });
    }),

  /** Get a planning session with its drafts and dependencies. */
  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.sessionType, "planning"),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) return null;

      const drafts = await ctx.db.query.planDrafts.findMany({
        where: eq(planDrafts.sessionId, input.sessionId),
        orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
      });

      const draftIds = drafts.map((d) => d.id);

      const deps =
        draftIds.length > 0
          ? await ctx.db.query.planDraftDependencies.findMany({
              where: inArray(planDraftDependencies.draftId, draftIds),
            })
          : [];

      return { session, drafts, dependencies: deps };
    }),

  /** List planning sessions for the current user. */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.db.query.chatConversations.findMany({
        where: and(
          eq(chatConversations.userId, ctx.session.user.id),
          eq(chatConversations.sessionType, "planning"),
        ),
        orderBy: desc(chatConversations.createdAt),
        limit: input.limit,
      });

      return sessions;
    }),

  // --- Draft CRUD ---

  createDraft: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        title: z.string().min(1).max(256),
        description: z.string().optional(),
        kind: z.enum(["issue", "task", "epic"]).default("task"),
        priority: z
          .enum(["no_priority", "urgent", "high", "medium", "low"])
          .default("no_priority"),
        sortOrder: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .insert(planDrafts)
        .values({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? null,
          kind: input.kind,
          priority: input.priority,
          sortOrder: input.sortOrder,
        })
        .returning();

      return draft!;
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(256).optional(),
        description: z.string().optional(),
        kind: z.enum(["issue", "task", "epic"]).optional(),
        priority: z
          .enum(["no_priority", "urgent", "high", "medium", "low"])
          .optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [draft] = await ctx.db
        .update(planDrafts)
        .set(updates)
        .where(eq(planDrafts.id, id))
        .returning();

      return draft!;
    }),

  removeDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(planDrafts).where(eq(planDrafts.id, input.id));
      return { ok: true };
    }),

  setDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dep] = await ctx.db
        .insert(planDraftDependencies)
        .values({
          draftId: input.draftId,
          dependsOnDraftId: input.dependsOnDraftId,
        })
        .returning();

      return dep!;
    }),

  removeDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(planDraftDependencies)
        .where(
          and(
            eq(planDraftDependencies.draftId, input.draftId),
            eq(
              planDraftDependencies.dependsOnDraftId,
              input.dependsOnDraftId,
            ),
          ),
        );
      return { ok: true };
    }),

  /** Commit all drafts — batch-create tasks via planning API. */
  commitPlan: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const drafts = await ctx.db.query.planDrafts.findMany({
        where: and(
          eq(planDrafts.sessionId, input.sessionId),
          eq(planDrafts.status, "draft"),
        ),
        orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
      });

      if (drafts.length === 0) {
        return { committed: 0, tasks: [] };
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PLANNING_API_KEY not configured",
        });
      }

      // Create tasks on planning API one by one, collecting results
      const createdTasks: Array<{
        draftId: string;
        taskId: string;
        identifier: string;
      }> = [];

      for (const draft of drafts) {
        const url = `${getPlanningBaseUrl()}/api/trpc/issue.create`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": planningApiKey,
          },
          body: JSON.stringify({
            "0": {
              json: {
                projectId: draft.projectId,
                title: draft.title,
                description: draft.description,
                status: "todo",
                priority: draft.priority,
              },
            },
          }),
        });

        if (!response.ok) {
          console.error(
            `[planSession] Failed to create task for draft ${draft.id}: ${response.status}`,
          );
          continue;
        }

        const result = (await response.json()) as Array<{
          result?: { data?: { json?: { id: string; identifier: string } } };
        }>;
        const created = result[0]?.result?.data?.json;

        if (created) {
          createdTasks.push({
            draftId: draft.id,
            taskId: created.id,
            identifier: created.identifier,
          });
        }
      }

      // Mark drafts as committed
      if (createdTasks.length > 0) {
        const committedIds = createdTasks.map((t) => t.draftId);
        await ctx.db
          .update(planDrafts)
          .set({ status: "committed" })
          .where(inArray(planDrafts.id, committedIds));
      }

      return { committed: createdTasks.length, tasks: createdTasks };
    }),
} satisfies TRPCRouterRecord;
