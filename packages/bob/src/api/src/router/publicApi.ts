import { z } from "zod/v4";

import { agentRunStatusEnum } from "@bob/db/schema";

import {
  protectedProcedure,
  apiKeyReadProcedure,
  apiKeyWriteProcedure,
} from "../trpc";
import {
  publicApiRegisterWorkspace,
  publicApiCreateRun,
  publicApiDispatchExecution,
  publicApiCreateProject,
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
        // Optional: when omitted, resolved from the work-item override ->
        // project default -> workspace default -> "claude" hierarchy.
        agentType: z.string().min(1).max(64).optional(),
        agentConfig: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiCreateRun(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /dispatch — create an EXECUTABLE session (gated: BOB_OODA_DISPATCH_ENABLED).
  // Unlike createRun (record-only), this runs the agent. Carries an opaque `ooda`
  // correlation for read-back. See publicApiDispatchExecution for the security model.
  dispatchExecution: apiKeyWriteProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        title: z.string().min(1).max(500),
        description: z.string().max(20000).optional(),
        agentType: z.string().min(1).max(64).optional(),
        // Optional working directory for the run (validated server-side to stay
        // under /home/bob/dev). Used by "Make it a project" scaffolds so
        // create-gmacko-app runs in a fresh project dir, not the bob monorepo.
        workingDirectory: z.string().max(512).optional(),
        // Opaque OODA correlation for M2 read-back. threadSlug is the thread
        // workspace directory (what the runner resolves); threadId is the UUID
        // for provenance/entity extraction. At least one is required.
        ooda: z
          .object({
            threadId: z.string().min(1).max(200).optional(),
            threadSlug: z.string().min(1).max(200).optional(),
          })
          .refine((o) => Boolean(o.threadId || o.threadSlug), {
            message: "ooda requires threadId or threadSlug",
          })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiDispatchExecution(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // POST /projects — create a (linear-clone) project + seed backlog tasks.
  // The OODA "Make it a project" path. Scaffolding (create-gmacko-app) is a
  // separate dispatchExecution call by the caller.
  createProject: apiKeyWriteProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(128),
        description: z.string().max(20000).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        tasks: z.array(z.string().min(1).max(256)).max(20).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      publicApiCreateProject(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // PATCH /runs/:id — update run status
  updateRun: apiKeyWriteProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        // Full agent-run status set (single source of truth:
        // @bob/agents/schema) so "blocked", "interrupted" and
        // "host_unknown" can be reported instead of being rejected.
        status: z.enum(agentRunStatusEnum.enumValues),
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
