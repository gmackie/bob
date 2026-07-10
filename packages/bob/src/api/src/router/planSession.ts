import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  planSessionCreate,
  planSessionStart,
  planSessionGet,
  planSessionList,
  planSessionListByWorkItem,
  planSessionGetActiveForWorkItem,
  planSessionSaveArtifact,
  planSessionUpdateArtifact,
  planSessionListArtifacts,
  planSessionListMessages,
  planSessionSendMessage,
  planSessionGetPriorContext,
  planSessionCreateDraft,
  planSessionUpdateDraft,
  planSessionRemoveDraft,
  planSessionSetDependency,
  planSessionRemoveDependency,
  planSessionCommitPlan,
  planSessionCommitPlanLocal,
} from "../handlers/planSession";

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
            "shape",
          ])
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      planSessionStart({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Get a planning session with its drafts and dependencies. */
  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planSessionGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List planning sessions for the current user. */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      planSessionList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List planning sessions for a specific work item. */
  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      planSessionListByWorkItem({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Get the most recent active (non-stopped) planning session for a work item. */
  getActiveForWorkItem: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planSessionGetActiveForWorkItem({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
            "shape",
          ])
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionSaveArtifact({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Collaborative edit of a planning artifact (optimistic concurrency via expectedVersion). */
  updateArtifact: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        content: z.string(),
        title: z.string().min(1).max(256).optional(),
        expectedVersion: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionUpdateArtifact({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List planning artifacts produced by a session. */
  listArtifacts: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planSessionListArtifacts({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List human collab chat messages for a planning session. */
  listMessages: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      planSessionListMessages({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Send a human collab chat message in a planning session. */
  sendMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        body: z.string().min(1).max(4000),
        clientMessageId: z.string().max(128).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionSendMessage({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Get prior planning context for a work item (for context chaining). */
  getPriorContext: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        excludeSessionId: z.string().uuid().optional(),
        maxChars: z.number().int().min(0).default(8000),
      }),
    )
    .query(({ ctx, input }) =>
      planSessionGetPriorContext({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      planSessionCreateDraft({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      planSessionUpdateDraft({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  removeDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planSessionRemoveDraft({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  setDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionSetDependency({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  removeDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionRemoveDependency({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Commit all drafts — batch-create tasks via planning API. */
  commitPlan: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planSessionCommitPlan({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Commit drafts as local work items with dependencies preserved. */
  commitPlanLocal: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        parentWorkItemId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planSessionCommitPlanLocal({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
