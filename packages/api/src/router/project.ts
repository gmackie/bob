import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import { and, desc, eq } from "@bob/db";
import {
  discoveredDirs,
  projects,
  repositories,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";

import { detectProjectCapabilities } from "../services/projects/projectCapabilities";
import { protectedProcedure } from "../trpc";

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

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
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

      const [project] = await ctx.db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          key: input.key.toUpperCase(),
          description: input.description ?? null,
          color: input.color ?? null,
        })
        .returning();
      return project!;
    }),

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

      const projectRows = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
        orderBy: desc(projects.updatedAt),
      });

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.workspaceId, input.workspaceId),
      });

      return projectRows.map((project) => {
        const projectItems = items.filter((item) => item.projectId === project.id);

        return {
          project,
          counts: {
            issues: projectItems.filter((item) => item.kind === "issue").length,
            tasks: projectItems.filter((item) => item.kind === "task").length,
            epics: projectItems.filter((item) => item.kind === "epic").length,
            active: projectItems.filter(
              (item) =>
                item.status === "in_progress" || item.status === "in_review",
            ).length,
          },
        };
      });
    }),

  get: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
      });

      if (!project) {
        return null;
      }

      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, project.workspaceId);

      const linkedRepository = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.planningProjectId, project.id),
          eq(repositories.userId, ctx.session.user.id),
        ),
      });

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.projectId, input.id),
      });

      const capabilities = detectProjectCapabilities({
        repositoryPath: linkedRepository?.path,
      });

      return {
        project,
        linkedRepository: linkedRepository
          ? {
              id: linkedRepository.id,
              name: linkedRepository.name,
              path: linkedRepository.path,
              remoteProvider: linkedRepository.remoteProvider,
              remoteOwner: linkedRepository.remoteOwner,
              remoteName: linkedRepository.remoteName,
              remoteUrl: linkedRepository.remoteUrl,
            }
          : null,
        capabilities,
        counts: {
          issues: items.filter((item) => item.kind === "issue").length,
          tasks: items.filter((item) => item.kind === "task").length,
          epics: items.filter((item) => item.kind === "epic").length,
          active: items.filter(
            (item) =>
              item.status === "in_progress" || item.status === "in_review",
          ).length,
        },
      };
    }),

  updateAutomationSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        settings: z.object({
          autoDispatch: z.boolean().optional(),
          autoBranch: z.boolean().optional(),
          autoPR: z.boolean().optional(),
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
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        columns: { workspaceId: true, automationSettings: true },
      });

      if (!existing) {
        throw new Error("Project not found");
      }

      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, existing.workspaceId);

      const merged = {
        ...(existing.automationSettings ?? {}),
        ...input.settings,
      };

      const [updated] = await ctx.db
        .update(projects)
        .set({ automationSettings: merged })
        .where(eq(projects.id, input.projectId))
        .returning();

      return updated!;
    }),

  discovery: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

      // Get all non-stale repos for this workspace
      const allRepos = await ctx.db.query.repositories.findMany({
        where: and(
          eq(repositories.workspaceId, input.workspaceId),
          eq(repositories.stale, false),
        ),
      });

      // Get all projects for this workspace
      const allProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
      });

      // Get non-dismissed, non-git directories
      const nonGitDirs = await ctx.db.query.discoveredDirs.findMany({
        where: and(
          eq(discoveredDirs.workspaceId, input.workspaceId),
          eq(discoveredDirs.dismissed, false),
        ),
      });

      // Get workspace for forge status
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });

      // Classify repos: linked (has a matching project) vs gitOnly (no project)
      // forgeReady is transient (one heartbeat cycle) — repos matched to a forge
      // app get auto-linked to a project immediately, so we return an empty array
      // for backward compatibility with the UI.
      const linked: typeof allRepos = [];
      const gitOnly: typeof allRepos = [];

      for (const repo of allRepos) {
        const project = allProjects.find(
          (p) =>
            p.id === repo.planningProjectId ||
            (p.forgeGraphAppId &&
              p.repoUrl &&
              repo.remoteUrl &&
              p.repoUrl.replace(/\.git$/, "") ===
                repo.remoteUrl.replace(/\.git$/, "")),
        );

        if (project) {
          linked.push(repo);
        } else {
          gitOnly.push(repo);
        }
      }

      return {
        forgeAvailable: workspace?.forgeAvailable ?? false,
        linked: linked.map((r) => ({
          ...r,
          project: allProjects.find((p) => p.id === r.planningProjectId),
        })),
        forgeReady: [] as typeof allRepos,
        gitOnly,
        nonGit: nonGitDirs,
      };
    }),

  dismissDir: protectedProcedure
    .input(z.object({ dirId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const dir = await ctx.db.query.discoveredDirs.findFirst({
        where: eq(discoveredDirs.id, input.dirId),
      });
      if (!dir) throw new TRPCError({ code: "NOT_FOUND" });
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, dir.workspaceId);

      await ctx.db
        .update(discoveredDirs)
        .set({ dismissed: true })
        .where(eq(discoveredDirs.id, input.dirId));
      return { ok: true };
    }),
};
