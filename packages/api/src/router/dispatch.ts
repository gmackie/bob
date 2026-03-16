import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray } from "@bob/db";
import {
  dispatchBatches,
  dispatchItems,
  planDraftDependencies,
  planDrafts,
  taskRuns,
} from "@bob/db/schema";

import { suggestAgent } from "../services/dispatch/agentHeuristics";
import { protectedProcedure } from "../trpc";

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
      const batch = await ctx.db.query.dispatchBatches.findFirst({
        where: eq(dispatchBatches.id, input.batchId),
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

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
      const batch = await ctx.db.query.dispatchBatches.findFirst({
        where: eq(dispatchBatches.id, input.batchId),
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

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
      const batch = await ctx.db.query.dispatchBatches.findFirst({
        where: eq(dispatchBatches.id, input.batchId),
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      const items = await ctx.db.query.dispatchItems.findMany({
        where: eq(dispatchItems.batchId, input.batchId),
        orderBy: [dispatchItems.sortOrder],
      });

      let completedCount = batch.completedTasks;
      let failedCount = batch.failedTasks;

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
              .set({ status: "completed" })
              .where(eq(dispatchItems.id, item.id));
            completedCount++;
          } else if (run.status === "failed") {
            await ctx.db
              .update(dispatchItems)
              .set({ status: "failed" })
              .where(eq(dispatchItems.id, item.id));
            failedCount++;
          }
        }
      }

      // Update batch counters
      await ctx.db
        .update(dispatchBatches)
        .set({
          completedTasks: completedCount,
          failedTasks: failedCount,
        })
        .where(eq(dispatchBatches.id, input.batchId));

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
              failedCount++;
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
          .set({
            status: "completed",
            completedTasks: completedCount,
            failedTasks: failedCount,
          })
          .where(eq(dispatchBatches.id, input.batchId));
      } else {
        await ctx.db
          .update(dispatchBatches)
          .set({
            completedTasks: completedCount,
            failedTasks: failedCount,
          })
          .where(eq(dispatchBatches.id, input.batchId));
      }

      // Return updated batch
      const updatedBatch = await ctx.db.query.dispatchBatches.findFirst({
        where: eq(dispatchBatches.id, input.batchId),
      });

      return { batch: updatedBatch!, items: finalItems };
    }),
} satisfies TRPCRouterRecord;
