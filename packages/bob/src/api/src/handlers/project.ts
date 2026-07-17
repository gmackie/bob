/**
 * Project handler functions — pure business logic extracted from the tRPC
 * project router.
 *
 * Phase 7B-4D-beta Task 3.
 */
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

import type { HandlerContext } from "./context.js";

type ProjectListItem = {
  project: unknown;
  counts: {
    issues: number;
    tasks: number;
    epics: number;
    active: number;
  };
  _latestActivity: string | null | undefined;
};

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function projectCreate(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    name: string;
    key: string;
    description?: string;
    color?: string;
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

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
}

export async function projectList(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const projectRows = await ctx.db.query.projects.findMany({
    where: eq(projects.workspaceId, input.workspaceId),
    orderBy: desc(projects.updatedAt),
  });

  const items = await ctx.db.query.workItems.findMany({
    where: eq(workItems.workspaceId, input.workspaceId),
  });

  const result: ProjectListItem[] = projectRows.map((project: any) => {
    const projectItems = items.filter((item: any) => item.projectId === project.id);
    const latestItemDate = projectItems.reduce((latest: string | null, item: any) => {
      const d = item.updatedAt ?? item.createdAt;
      return d && (!latest || d > latest) ? d : latest;
    }, null);

    return {
      project,
      counts: {
        issues: projectItems.filter((item: any) => item.kind === "issue").length,
        tasks: projectItems.filter((item: any) => item.kind === "task").length,
        epics: projectItems.filter((item: any) => item.kind === "epic").length,
        active: projectItems.filter(
          (item: any) =>
            item.status === "in_progress" || item.status === "in_review",
        ).length,
      },
      _latestActivity: latestItemDate ?? project.updatedAt ?? project.createdAt,
    };
  });

  result.sort((a, b) => {
    if (a._latestActivity && b._latestActivity) return b._latestActivity > a._latestActivity ? 1 : -1;
    return a._latestActivity ? -1 : 1;
  });

  return result;
}

export async function projectGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, input.id),
  });

  if (!project) {
    return null;
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, project.workspaceId);

  const linkedRepository = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.planningProjectId, project.id),
      eq(repositories.userId, ctx.userId),
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
      issues: items.filter((item: any) => item.kind === "issue").length,
      tasks: items.filter((item: any) => item.kind === "task").length,
      epics: items.filter((item: any) => item.kind === "epic").length,
      active: items.filter(
        (item: any) =>
          item.status === "in_progress" || item.status === "in_review",
      ).length,
    },
  };
}

export async function projectUpdateAutomationSettings(
  ctx: HandlerContext,
  input: {
    projectId: string;
    settings: {
      autoDispatch?: boolean;
      autoBranch?: boolean;
      autoFeaturePR?: boolean;
      ciTrigger?: boolean;
      reactFrontend?: boolean;
      stageSkills?: Record<
        string,
        Array<{ slug: string; label: string; enabled: boolean }>
      >;
    };
  },
) {
  const existing = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, input.projectId),
    columns: { workspaceId: true, automationSettings: true },
  });

  if (!existing) {
    throw new Error("Project not found");
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, existing.workspaceId);

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
}

export async function projectDiscovery(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

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
      (p: any) =>
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
    linked: linked.map((r: any) => ({
      ...r,
      project: allProjects.find((p: any) => p.id === r.planningProjectId),
    })),
    forgeReady: [] as typeof allRepos,
    gitOnly,
    nonGit: nonGitDirs,
  };
}

export async function projectDismissDir(
  ctx: HandlerContext,
  input: { dirId: string },
) {
  const dir = await ctx.db.query.discoveredDirs.findFirst({
    where: eq(discoveredDirs.id, input.dirId),
  });
  if (!dir) throw new TRPCError({ code: "NOT_FOUND" });
  await assertWorkspaceAccess(ctx.db, ctx.userId, dir.workspaceId);

  await ctx.db
    .update(discoveredDirs)
    .set({ dismissed: true })
    .where(eq(discoveredDirs.id, input.dirId));
  return { ok: true };
}
