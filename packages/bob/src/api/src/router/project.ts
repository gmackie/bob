import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  projectCreate,
  projectList,
  projectGet,
  projectUpdateAutomationSettings,
  projectSetDefaultAgent,
  projectDiscovery,
  projectDismissDir,
  projectRegisterForge,
} from "../handlers/project";

export const projectRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(128),
        key: z.string().min(1).max(16),
        description: z.string().optional(),
        color: z.string().max(7).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      projectCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      projectList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      projectGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateAutomationSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        settings: z.object({
          autoDispatch: z.boolean().optional(),
          autoBranch: z.boolean().optional(),
          autoFeaturePR: z.boolean().optional(),
          ciTrigger: z.boolean().optional(),
          reactFrontend: z.boolean().optional(),
          stageSkills: z
            .record(
              z.string(),
              z.array(
                z.object({
                  slug: z.string(),
                  label: z.string(),
                  enabled: z.boolean(),
                }),
              ),
            )
            .optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      projectUpdateAutomationSettings({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  setDefaultAgent: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        defaultAgentType: z.string().max(50).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      projectSetDefaultAgent({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  discovery: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      projectDiscovery({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  dismissDir: protectedProcedure
    .input(z.object({ dirId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      projectDismissDir({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // Registers a discovered repository (by daemon path) as a ForgeGraph-linked
  // project. Replaces the removed `/forge/register` gateway proxy.
  registerForge: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        path: z.string().min(1),
        key: z.string().min(1).max(16).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      projectRegisterForge({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
};
