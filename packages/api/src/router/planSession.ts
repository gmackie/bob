import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray, ne } from "@bob/db";
import {
  chatConversations,
  planDraftDependencies,
  planDrafts,
  projects,
  workItemArtifacts,
  workItems,
} from "@bob/db/schema";

import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "../services/integrations/planningRemoteConfig";
import { protectedProcedure } from "../trpc";

const planningLaunchContextSchema = z.object({
  intent: z.enum(["shape", "breakdown"]),
  notes: z.string(),
  workItem: z
    .object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      kind: z.string(),
    })
    .optional(),
  selectedRepoSources: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      path: z.string(),
      detail: z.string(),
    }),
  ),
  attachedFiles: z.array(
    z.object({
      name: z.string(),
      sizeLabel: z.string(),
      content: z.string().optional(),
    }),
  ),
});

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
        planningSessionType: z
          .enum([
            "office_hours",
            "ceo_review",
            "eng_review",
            "design_review",
            "breakdown",
          ])
          .optional(),
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
          planningSessionType: input.planningSessionType ?? null,
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
        launchContext: planningLaunchContextSchema.optional(),
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

  /** List planning sessions for a specific work item. */
  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.db.query.chatConversations.findMany({
        where: and(
          eq(chatConversations.userId, ctx.session.user.id),
          eq(chatConversations.sessionType, "planning"),
          eq(chatConversations.workItemId, input.workItemId),
        ),
        orderBy: desc(chatConversations.createdAt),
        limit: input.limit,
      });

      return sessions;
    }),

  /** Get the most recent active (non-stopped) planning session for a work item. */
  getActiveForWorkItem: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.userId, ctx.session.user.id),
          eq(chatConversations.sessionType, "planning"),
          eq(chatConversations.workItemId, input.workItemId),
          ne(chatConversations.status, "stopped"),
        ),
        orderBy: desc(chatConversations.createdAt),
      });

      return session ?? null;
    }),

  /** Save a planning artifact for a work item. */
  saveArtifact: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        workItemId: z.string().uuid(),
        title: z.string().min(1).max(256),
        content: z.string(),
        planningSessionType: z
          .enum([
            "office_hours",
            "ceo_review",
            "eng_review",
            "design_review",
            "breakdown",
          ])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .insert(workItemArtifacts)
        .values({
          workItemId: input.workItemId,
          sessionId: input.sessionId,
          artifactType: "planning_doc",
          artifactRole: input.planningSessionType ?? "planning",
          producerType: "bob",
          title: input.title,
          content: input.content,
          isCurrent: true,
        })
        .returning();

      return artifact!;
    }),

  /** Get prior planning context for a work item (for context chaining). */
  getPriorContext: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        excludeSessionId: z.string().uuid().optional(),
        maxChars: z.number().int().min(0).default(8000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.artifactType, "planning_doc"),
        eq(workItemArtifacts.isCurrent, true),
      ];

      if (input.excludeSessionId) {
        conditions.push(
          ne(workItemArtifacts.sessionId, input.excludeSessionId),
        );
      }

      const artifacts = await ctx.db.query.workItemArtifacts.findMany({
        where: and(...conditions),
        orderBy: desc(workItemArtifacts.createdAt),
      });

      // Truncate content to fit within the total character budget
      let remainingChars = input.maxChars;
      const result: Array<{
        id: string;
        title: string | null;
        sessionId: string | null;
        content: string | null;
        createdAt: Date;
      }> = [];

      for (const artifact of artifacts) {
        if (remainingChars <= 0) break;

        const content = artifact.content ?? "";
        const truncatedContent =
          content.length > remainingChars
            ? content.slice(0, remainingChars)
            : content;
        remainingChars -= truncatedContent.length;

        result.push({
          id: artifact.id,
          title: artifact.title,
          sessionId: artifact.sessionId,
          content: truncatedContent,
          createdAt: artifact.createdAt,
        });
      }

      return result;
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
