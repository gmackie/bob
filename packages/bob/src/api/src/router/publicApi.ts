import { z } from "zod/v4";

import {
  protectedProcedure,
  apiKeyReadProcedure,
  apiKeyWriteProcedure,
} from "../trpc";
import {
  publicApiRegisterWorkspace,
  publicApiCreateRun,
  publicApiUpdateRun,
  publicApiCreateArtifact,
  publicApiGetRun,
  publicApiListRuns,
  publicApiListRunsByWorkItem,
  publicApiHeartbeat,
  publicApiGenerateApiKey,
} from "../handlers/publicApi";

export const publicApiRouter = {
  // POST /workspaces — register a workspace
  registerWorkspace: apiKeyWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(64),
        machineId: z.string().min(1),
        repoPath: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiRegisterWorkspace(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /runs — create an agent run
  createRun: apiKeyWriteProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        workspaceId: z.string().uuid(),
        agentType: z.string().min(1).max(64),
        agentConfig: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiCreateRun(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // PATCH /runs/:id — update run status
  updateRun: apiKeyWriteProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        status: z.enum(["running", "completed", "failed"]),
        summary: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiUpdateRun(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /runs/:id/artifacts — upload artifact metadata
  createArtifact: apiKeyWriteProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        type: z.enum(["diff", "log", "test-report", "file-snapshot"]),
        storageKey: z.string().min(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiCreateArtifact(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // GET /runs/:id — get run with artifacts
  getRun: apiKeyReadProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      publicApiGetRun(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // GET /runs — list runs for a workspace
  listRuns: apiKeyReadProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      publicApiListRuns(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // GET /work-items/:id/runs — list runs for a work item
  listRunsByWorkItem: apiKeyReadProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      publicApiListRunsByWorkItem(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /workspaces/:id/heartbeat
  heartbeat: apiKeyWriteProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        agentTypes: z.array(z.string()).optional(),
        forgeAvailable: z.boolean().optional(),
        repos: z
          .array(
            z.object({
              name: z.string(),
              path: z.string(),
              isGit: z.boolean(),
              remoteUrl: z.string().optional(),
              branch: z.string().optional(),
              dirty: z.boolean().optional(),
              buildSystem: z.string().optional(),
              forgeAppId: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiHeartbeat(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /api-keys — generate a new API key
  generateApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).default("bob-cli"),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiGenerateApiKey(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
};
