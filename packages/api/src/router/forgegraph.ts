import { z } from "zod/v4";

import {
  type ForgeGraphResult,
  getDeploymentStatus,
  getRevision,
  listDeployments,
  listRepositories,
  listRevisions,
  triggerBuild,
} from "../services/forgegraph/forgegraphClient";
import { protectedProcedure } from "../trpc";

/**
 * Unwrap ForgeGraphResult: return data if available, throw-safe null otherwise.
 * This ensures the UI always gets a consistent shape.
 */
function unwrap<T>(result: ForgeGraphResult<T>): {
  available: boolean;
  data: T | null;
  error?: string;
} {
  if (result.available) {
    return { available: true, data: result.data };
  }
  return { available: false, data: null, error: result.error };
}

export const forgegraphRouter = {
  listRepositories: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ input }) => {
      return unwrap(await listRepositories(input.workspaceId));
    }),

  listRevisions: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid().optional(),
        workspaceId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      return unwrap(
        await listRevisions({
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          limit: input.limit,
        }),
      );
    }),

  getRevision: protectedProcedure
    .input(z.object({ revisionId: z.string() }))
    .query(async ({ input }) => {
      return unwrap(await getRevision(input.revisionId));
    }),

  triggerBuild: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        revisionId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return unwrap(
        await triggerBuild({
          task_id: input.taskId,
          revision_id: input.revisionId,
        }),
      );
    }),

  listDeployments: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid().optional(),
        environment: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return unwrap(
        await listDeployments({
          taskId: input.taskId,
          environment: input.environment,
        }),
      );
    }),

  getDeploymentStatus: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ input }) => {
      return unwrap(await getDeploymentStatus(input.deploymentId));
    }),
};
