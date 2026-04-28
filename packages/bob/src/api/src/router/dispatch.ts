import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray, sql } from "@bob/db";
import {
  chatConversations,
  dispatchBatches,
  dispatchItems,
  notifications,
  planDraftDependencies,
  planDrafts,
  pullRequests,
  taskRuns,
  workItemArtifacts,
  workItems,
} from "@bob/db/schema";

import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "../services/integrations/planningRemoteConfig";
import { suggestAgent } from "../services/dispatch/agentHeuristics";
import { protectedProcedure } from "../trpc";

async function loadOwnedSession(db: any, userId: string, sessionId: string) {
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
    columns: { id: true },
  });

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  }

  return session;
}

async function loadOwnedBatch(db: any, userId: string, batchId: string) {
  const batch = await db.query.dispatchBatches.findFirst({
    where: and(
      eq(dispatchBatches.id, batchId),
      eq(dispatchBatches.userId, userId),
    ),
  });

  if (!batch) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Batch not found",
    });
  }

  return batch;
}

async function loadOwnedDispatchItem(db: any, userId: string, itemId: string) {
  const item = await db.query.dispatchItems.findFirst({
    where: eq(dispatchItems.id, itemId),
    with: { batch: true },
  });

  if (!item || item.batch.userId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dispatch item not found",
    });
  }

  return item;
}

/**
 * Fire-and-forget update of a planning task's status via the planning API.
 * Gracefully degrades if no API key is configured.
 */
async function updatePlanningTaskStatus(
  taskId: string,
  status: string,
): Promise<void> {
  const planningApiKey = getPlanningApiKey();
  if (!planningApiKey) return;

  const url = `${getPlanningBaseUrl()}/api/trpc/issue.update`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": planningApiKey,
      },
      body: JSON.stringify({
        "0": { json: { id: taskId, status } },
      }),
    });
  } catch (err) {
    console.error(
      `[dispatch] Failed to update planning task ${taskId}: ${err}`,
    );
  }
}

/**
 * Fire-and-forget: trigger a code-reviewer smol-agent session for a completed
 * dispatch item that has an associated pull request.
 */
async function triggerCodeReview(
  database: typeof import("@bob/db/client").db,
  item: {
    planningTaskId: string;
    planningTaskIdentifier: string;
    title: string;
    description: string | null;
    taskRunId: string | null;
  },
  userId: string,
): Promise<void> {
  if (!item.taskRunId) return;

  // Look up the task run to get the PR ID
  const taskRun = await database.query.taskRuns.findFirst({
    where: eq(taskRuns.id, item.taskRunId),
  });
  if (!taskRun?.pullRequestId) return;

  // Look up PR details for the diff URL
  const pr = await database.query.pullRequests.findFirst({
    where: eq(pullRequests.id, taskRun.pullRequestId),
  });
  if (!pr) return;

  // Build a diff URL from the PR info
  const prDiffUrl = pr.url.endsWith(".diff") ? pr.url : `${pr.url}.diff`;

  // Look up the work item for requirements (description serves as requirements)
  const workItem = await database.query.workItems.findFirst({
    where: eq(workItems.id, item.planningTaskId),
  });

  // Build the requirements list from the work item description
  const requirements: string[] = [];
  if (workItem?.description) {
    // Split description into lines, use non-empty lines as requirements
    const lines = workItem.description.split("\n").filter((l) => l.trim());
    requirements.push(...lines);
  }

  // Look up the session to get the working directory
  const session = taskRun.sessionId
    ? await database.query.chatConversations.findFirst({
        where: eq(chatConversations.id, taskRun.sessionId),
      })
    : null;

  const workingDirectory = session?.workingDirectory ?? "/tmp";

  // Build the review profile
  const { buildSmolAgentReviewProfile } = await import(
    "@bob/execution/planning/smolAgentReviewProfile"
  );

  // Create a review session record
  const [reviewSession] = await database
    .insert(chatConversations)
    .values({
      userId,
      repositoryId: taskRun.repositoryId,
      worktreeId: taskRun.worktreeId,
      workingDirectory,
      agentType: "smol-agent",
      title: `Review: ${item.planningTaskIdentifier} - ${item.title}`,
      status: "provisioning",
      workItemId: workItem?.id ?? null,
      workItemIdentifierSnapshot: item.planningTaskIdentifier,
      gitBranch: taskRun.branch,
      sessionType: "review",
    })
    .returning();

  if (!reviewSession) return;

  // Create a review task run
  const [reviewTaskRun] = await database
    .insert(taskRuns)
    .values({
      userId,
      workItemId: workItem?.id ?? null,
      workItemIdentifierSnapshot: item.planningTaskIdentifier,
      planningWorkspaceId: taskRun.planningWorkspaceId,
      planningItemId: item.planningTaskId,
      planningItemIdentifier: item.planningTaskIdentifier,
      sessionId: reviewSession.id,
      repositoryId: taskRun.repositoryId,
      worktreeId: taskRun.worktreeId,
      status: "starting",
      branch: taskRun.branch,
      runPhase: "review",
      parentTaskRunId: taskRun.id,
    })
    .returning();

  if (!reviewTaskRun) return;

  const profile = buildSmolAgentReviewProfile({
    sessionId: reviewSession.id,
    workItemId: item.planningTaskId,
    pullRequestId: taskRun.pullRequestId,
    workItemTitle: item.title,
    prDiffUrl,
    requirements,
    taskDescription: item.description ?? item.title,
    workingDirectory,
  });

  const { gatewayRequest } = await import(
    "@bob/execution/runtime/taskExecutor"
  );

  await gatewayRequest(userId, "/session/start", {
    sessionId: reviewSession.id,
    workingDirectory,
    agentType: "smol-agent",
    initialPrompt: profile.initialPrompt,
    env: {
      ...profile.env,
      BOB_API_URL: process.env.BOB_API_URL ?? "http://localhost:3000",
      ...(process.env.BOB_API_KEY ? { BOB_API_KEY: process.env.BOB_API_KEY } : {}),
    },
  });
}

export const dispatchRouter = {
  /**
   * Create a dispatch batch from committed plan drafts.
   * Call this after commitPlan — pass the task mappings returned by commitPlan.
   */
  createBatch: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        concurrency: z.number().int().min(1).max(10).default(2),
        tasks: z.array(
          z.object({
            draftId: z.string().uuid(),
            taskId: z.string(),
            identifier: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwnedSession(ctx.db, ctx.session.user.id, input.sessionId);

      // Fetch committed drafts for this session
      const drafts = await ctx.db.query.planDrafts.findMany({
        where: and(
          eq(planDrafts.sessionId, input.sessionId),
          eq(planDrafts.status, "committed"),
        ),
        orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
      });

      if (drafts.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No committed drafts found for this session",
        });
      }

      // Build a map from draftId → task info
      const taskMap = new Map(
        input.tasks.map((t) => [t.draftId, t]),
      );

      // Filter to only drafts that have matching task mappings
      const matchedDrafts = drafts.filter((d) => taskMap.has(d.id));

      if (matchedDrafts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No task mappings match the committed drafts",
        });
      }

      // Fetch draft dependencies
      const draftIds = matchedDrafts.map((d) => d.id);
      const deps =
        draftIds.length > 0
          ? await ctx.db.query.planDraftDependencies.findMany({
              where: inArray(planDraftDependencies.draftId, draftIds),
            })
          : [];

      // Get workspaceId/projectId from first draft
      const firstDraft = matchedDrafts[0]!;

      // Create the dispatch batch
      const [batch] = await ctx.db
        .insert(dispatchBatches)
        .values({
          userId: ctx.session.user.id,
          sessionId: input.sessionId,
          workspaceId: firstDraft.workspaceId,
          projectId: firstDraft.projectId,
          status: "pending",
          concurrency: input.concurrency,
          totalTasks: matchedDrafts.length,
        })
        .returning();

      if (!batch) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create dispatch batch",
        });
      }

      // Create dispatch items — first pass to get IDs, then update blocked status
      // We need to map draftId → dispatchItemId for dependency resolution
      const draftToItemId = new Map<string, string>();

      // Build dependency lookup: draftId → set of dependsOnDraftIds
      const depsMap = new Map<string, Set<string>>();
      for (const dep of deps) {
        const set = depsMap.get(dep.draftId) ?? new Set();
        set.add(dep.dependsOnDraftId);
        depsMap.set(dep.draftId, set);
      }

      // Insert all items first (to get their IDs)
      const itemValues = matchedDrafts.map((draft, idx) => {
        const task = taskMap.get(draft.id)!;
        return {
          batchId: batch.id,
          planningTaskId: task.taskId,
          planningTaskIdentifier: task.identifier,
          title: draft.title,
          description: draft.description ?? null,
          agentType: suggestAgent({
            kind: draft.kind,
            title: draft.title,
            description: draft.description ?? null,
          }),
          status: "queued" as const, // Will update to "blocked" after mapping
          blockedByItems: [] as string[],
          sortOrder: idx,
        };
      });

      const insertedItems = await ctx.db
        .insert(dispatchItems)
        .values(itemValues)
        .returning();

      // Build draftId → dispatchItemId mapping
      for (let i = 0; i < matchedDrafts.length; i++) {
        const draft = matchedDrafts[i]!;
        const item = insertedItems[i]!;
        draftToItemId.set(draft.id, item.id);
      }

      // Update items that have dependencies
      for (let i = 0; i < matchedDrafts.length; i++) {
        const draft = matchedDrafts[i]!;
        const item = insertedItems[i]!;
        const draftDeps = depsMap.get(draft.id);

        if (draftDeps && draftDeps.size > 0) {
          // Map draft dependency IDs to dispatch item IDs
          const blockedByItemIds: string[] = [];
          for (const depDraftId of draftDeps) {
            const itemId = draftToItemId.get(depDraftId);
            if (itemId) {
              blockedByItemIds.push(itemId);
            }
          }

          if (blockedByItemIds.length > 0) {
            await ctx.db
              .update(dispatchItems)
              .set({
                status: "blocked",
                blockedByItems: blockedByItemIds,
              })
              .where(eq(dispatchItems.id, item.id));
          }
        }
      }

      // Re-fetch items with updated status
      const items = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, batch.id),
        orderBy: [dispatchItems.sortOrder],
      });

      return { batch, items };
    }),

  /** Get a batch with all its items. */
  getBatch: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const batch = await loadOwnedBatch(ctx.db, ctx.session.user.id, input.batchId);

      const items = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      return { batch, items };
    }),

  /** Update the agent type for a dispatch item. */
  updateItemAgent: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        agentType: z.string().min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwnedDispatchItem(ctx.db, ctx.session.user.id, input.itemId);

      const [item] = await ctx.db
        .update(dispatchItems)
        .set({ agentType: input.agentType })
        .where(eq(dispatchItems.id, input.itemId))
        .returning();

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dispatch item not found",
        });
      }

      return item;
    }),

  /** Update the concurrency limit for a batch. */
  updateConcurrency: protectedProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        concurrency: z.number().int().min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwnedBatch(ctx.db, ctx.session.user.id, input.batchId);

      const [batch] = await ctx.db
        .update(dispatchBatches)
        .set({ concurrency: input.concurrency })
        .where(eq(dispatchBatches.id, input.batchId))
        .returning();

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      return batch;
    }),

  /** Start dispatching a batch — execute queued items up to concurrency limit. */
  dispatch: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await loadOwnedBatch(ctx.db, ctx.session.user.id, input.batchId);

      // Set batch to dispatching
      await ctx.db
        .update(dispatchBatches)
        .set({ status: "dispatching" })
        .where(eq(dispatchBatches.id, input.batchId));

      // Find queued (unblocked) items
      const queuedItems = await ctx.db.query.dispatchItems.findMany({
        where: and(
          eq(dispatchItems.batchId, input.batchId),
          eq(dispatchItems.status, "queued"),
        ),
        orderBy: [dispatchItems.sortOrder],
      });

      // Take up to concurrency limit
      const toDispatch = queuedItems.slice(0, batch.concurrency);

      if (toDispatch.length === 0) {
        await ctx.db
          .update(dispatchBatches)
          .set({ status: "running" })
          .where(eq(dispatchBatches.id, input.batchId));

        return { started: 0 };
      }

      const { executeTask } = await import(
        "@bob/execution/runtime/taskExecutor"
      );

      let started = 0;

      for (const item of toDispatch) {
        try {
          const result = await executeTask(
            ctx.session.user.id,
            {
              id: item.planningTaskId,
              identifier: item.planningTaskIdentifier,
              title: item.title,
              description: item.description,
              workspaceId: batch.workspaceId,
              projectId: batch.projectId,
              assigneeId: null,
              labels: [],
              priority: 0,
            },
            { agentType: item.agentType },
          );

          await ctx.db
            .update(dispatchItems)
            .set({
              status: "running",
              taskRunId: result.taskRunId,
            })
            .where(eq(dispatchItems.id, item.id));

          started++;
        } catch (err) {
          console.error(
            `[dispatch] Failed to start item ${item.id}:`,
            err,
          );
          await ctx.db
            .update(dispatchItems)
            .set({ status: "failed" })
            .where(eq(dispatchItems.id, item.id));
        }
      }

      // Set batch to running
      await ctx.db
        .update(dispatchBatches)
        .set({ status: "running" })
        .where(eq(dispatchBatches.id, input.batchId));

      return { started };
    }),

  /** Check progress: update item statuses, unblock dependents, start next wave. */
  checkProgress: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await loadOwnedBatch(ctx.db, ctx.session.user.id, input.batchId);

      const items = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      let newCompleted = 0;
      let newFailed = 0;

      // Check running items for completion
      const runningItems = items.filter(
        (i) => i.status === "running" && i.taskRunId,
      );

      if (runningItems.length > 0) {
        const taskRunIds = runningItems
          .map((i) => i.taskRunId!)
          .filter(Boolean);

        const runs =
          taskRunIds.length > 0
            ? await ctx.db.query.taskRuns.findMany({
                where: inArray(taskRuns.id, taskRunIds),
              })
            : [];

        const runMap = new Map(runs.map((r) => [r.id, r]));

        for (const item of runningItems) {
          const run = runMap.get(item.taskRunId!);
          if (!run) continue;

          if (run.status === "completed") {
            await ctx.db
              .update(dispatchItems)
              .set({ status: "completed", pipelineState: "agent_complete" })
              .where(eq(dispatchItems.id, item.id));
            newCompleted++;

            // Update planning API status to "in_review"
            void updatePlanningTaskStatus(item.planningTaskId, "in_review");

            // Auto-trigger code reviewer if PR exists on the task run
            void triggerCodeReview(ctx.db, item, batch.userId).catch((err) =>
              console.error(`[dispatch] Failed to trigger code review:`, err),
            );

            // Report to ForgeGraph
            if (item.taskRunId) {
              const { ForgeGraphEventReporter } = await import(
                "../services/forgegraph/eventReporter"
              );
              const reporter = new ForgeGraphEventReporter(ctx.db);
              void reporter.reportApproved(item.taskRunId);
            }

            // Insert task-completed notification
            await ctx.db.insert(notifications).values({
              userId: batch.userId,
              title: `Task ${item.planningTaskIdentifier} completed`,
              body: `Agent ${item.agentType} finished work on "${item.title}"`,
              type: "task_completed",
              url: `/work-items/${item.planningTaskId}`,
            });

            // Auto-create PR for the completed task run
            if (run.repositoryId && run.branch) {
              const { onSessionComplete } = await import(
                "../services/automation/branch-automation"
              );
              const prResult = await onSessionComplete({
                sessionId: run.sessionId ?? run.id,
                workItemId: run.workItemId ?? item.planningTaskId,
                identifier: item.planningTaskIdentifier,
                repositoryId: run.repositoryId,
                branch: run.branch,
                userId: batch.userId,
              });
              if (prResult.prId) {
                // Link the PR back to the task run
                await ctx.db
                  .update(taskRuns)
                  .set({ pullRequestId: prResult.prId })
                  .where(eq(taskRuns.id, run.id));

                // Create forge revision with real commit SHA (not branch name placeholder)
                const { onPullRequestCreated } = await import(
                  "../services/automation/pipeline-trigger"
                );
                void onPullRequestCreated({
                  pullRequestId: prResult.prId,
                  repositoryId: run.repositoryId!,
                  headBranch: run.branch!,
                  headSha: prResult.headSha ?? run.branch!,
                  taskId: run.workItemId ?? item.planningTaskId,
                  taskRunId: run.id,
                }).catch(() => { /* best-effort */ });
              }
            }
          } else if (run.status === "failed") {
            await ctx.db
              .update(dispatchItems)
              .set({ status: "failed" })
              .where(eq(dispatchItems.id, item.id));
            newFailed++;

            // Report to ForgeGraph
            if (item.taskRunId) {
              const { ForgeGraphEventReporter } = await import(
                "../services/forgegraph/eventReporter"
              );
              const reporter = new ForgeGraphEventReporter(ctx.db);
              void reporter.reportFailed(item.taskRunId);
            }
          }
        }
      }

      // Update batch counters atomically to avoid race conditions
      if (newCompleted > 0 || newFailed > 0) {
        await ctx.db
          .update(dispatchBatches)
          .set({
            ...(newCompleted > 0 && {
              completedTasks: sql`${dispatchBatches.completedTasks} + ${newCompleted}`,
            }),
            ...(newFailed > 0 && {
              failedTasks: sql`${dispatchBatches.failedTasks} + ${newFailed}`,
            }),
          })
          .where(eq(dispatchBatches.id, input.batchId));
      }

      // Build set of completed item IDs for dependency checking
      // Re-fetch to get updated statuses
      const itemsAfterUpdate = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      const completedItemIds = new Set(
        itemsAfterUpdate
          .filter((i) => i.status === "completed")
          .map((i) => i.id),
      );

      // Check blocked items — unblock if all dependencies completed
      const blockedItems = itemsAfterUpdate.filter(
        (i) => i.status === "blocked",
      );

      for (const item of blockedItems) {
        const blockers = (item.blockedByItems as string[]) ?? [];
        const allDone = blockers.every((id) => completedItemIds.has(id));
        if (allDone) {
          await ctx.db
            .update(dispatchItems)
            .set({ status: "queued" })
            .where(eq(dispatchItems.id, item.id));
        }
      }

      // Re-fetch items to get current state after unblocking
      const updatedItems = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      const stillRunning = updatedItems.filter(
        (i) => i.status === "running",
      ).length;
      const slotsAvailable = batch.concurrency - stillRunning;

      if (slotsAvailable > 0) {
        const toStart = updatedItems
          .filter((i) => i.status === "queued")
          .slice(0, slotsAvailable);

        if (toStart.length > 0) {
          const { executeTask } = await import(
            "@bob/execution/runtime/taskExecutor"
          );

          for (const item of toStart) {
            try {
              const result = await executeTask(
                ctx.session.user.id,
                {
                  id: item.planningTaskId,
                  identifier: item.planningTaskIdentifier,
                  title: item.title,
                  description: item.description,
                  workspaceId: batch.workspaceId,
                  projectId: batch.projectId,
                  assigneeId: null,
                  labels: [],
                  priority: 0,
                },
                { agentType: item.agentType },
              );

              await ctx.db
                .update(dispatchItems)
                .set({
                  status: "running",
                  taskRunId: result.taskRunId,
                })
                .where(eq(dispatchItems.id, item.id));
            } catch (err) {
              console.error(
                `[dispatch] Failed to start item ${item.id}:`,
                err,
              );
              await ctx.db
                .update(dispatchItems)
                .set({ status: "failed" })
                .where(eq(dispatchItems.id, item.id));
              newFailed++;
            }
          }
        }
      }

      // Check if all items are done
      const finalItems = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      const allDone = finalItems.every(
        (i) => i.status === "completed" || i.status === "failed",
      );

      if (allDone) {
        await ctx.db
          .update(dispatchBatches)
          .set({ status: "completed" })
          .where(eq(dispatchBatches.id, input.batchId));

        // Re-read to get accurate counts for notification
        const finalBatch = await ctx.db.query.dispatchBatches.findFirst({
          where: eq(dispatchBatches.id, input.batchId),
        });

        // Batch completion notification
        await ctx.db.insert(notifications).values({
          userId: batch.userId,
          title: "Dispatch batch complete",
          body: `${finalBatch?.completedTasks ?? 0}/${batch.totalTasks} tasks finished`,
          type: "batch_completed",
        });
      }

      // Advance pipeline for items with active pipeline state
      const { advancePipeline } = await import(
        "../services/forgegraph/pipelineOrchestrator"
      );
      for (const item of finalItems) {
        if (
          item.pipelineState &&
          !["complete", "build_failed", "deploy_failed"].includes(
            item.pipelineState,
          )
        ) {
          await advancePipeline(ctx.db, item, {
            id: batch.id,
            userId: batch.userId,
          });
        }
      }

      // Return updated batch
      const updatedBatch = await ctx.db.query.dispatchBatches.findFirst({
        where: eq(dispatchBatches.id, input.batchId),
      });

      // Re-fetch items after pipeline advancement
      const pipelineItems = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      return { batch: updatedBatch!, items: pipelineItems };
    }),
  /** List dispatch batches for the current user, optionally filtered by status. */
  listBatches: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(dispatchBatches.userId, ctx.session.user.id)];
      if (input.status) {
        filters.push(eq(dispatchBatches.status, input.status));
      }
      return ctx.db.query.dispatchBatches.findMany({
        where: and(...filters),
        orderBy: desc(dispatchBatches.createdAt),
        limit: input.limit,
      });
    }),
  /** Reset a dispatch item's pipeline state to agent_complete (re-triggers build). */
  resetPipelineState: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify the item exists and the user owns the batch
      const item = await ctx.db.query.dispatchItems.findFirst({
        where: eq(dispatchItems.id, input.itemId),
        with: { batch: true },
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dispatch item not found",
        });
      }

      if (item.batch.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not own this dispatch batch",
        });
      }

      await ctx.db
        .update(dispatchItems)
        .set({ pipelineState: "agent_complete" })
        .where(eq(dispatchItems.id, input.itemId));

      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
