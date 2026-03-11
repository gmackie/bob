import { forgeRepositories, forgeRevisions, projects } from "@linear-clone/db";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const forgeStorageBackendEnum = z.enum(["s3", "rsync"]);

export const forgeRepositoryListInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

const forgeRepositoryCreateInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  storageBackend: forgeStorageBackendEnum.default("s3"),
  storagePrefix: z.string().min(1).optional(),
  projectId: z.string().uuid().optional(),
});

export const forgeRepositoryBookmarksInputSchema = z.object({
  repoId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(200),
});

function buildForgeStoragePrefix(
  workspaceId: string,
  providedPrefix: string | undefined
) {
  if (providedPrefix?.trim()) {
    return providedPrefix.trim();
  }

  return `${workspaceId}/${randomUUID()}`;
}

export const forgeRepositoryRouter = router({
  create: protectedProcedure
    .input(forgeRepositoryCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [repo] = await ctx.db
        .insert(forgeRepositories)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          storageBackend: input.storageBackend,
          storagePrefix: buildForgeStoragePrefix(
            input.workspaceId,
            input.storagePrefix
          ),
        })
        .returning();

      if (!repo) {
        throw new Error("Failed to create forge repository");
      }

      if (!input.projectId) return repo;

      const [project] = await ctx.db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          forgeRepositoryId: projects.forgeRepositoryId,
        })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      if (!project) {
        throw new Error("Project not found");
      }

      if (project.workspaceId !== input.workspaceId) {
        throw new Error("Project and forge repo workspace mismatch");
      }

      if (project.forgeRepositoryId) {
        throw new Error("Project is already linked to a forge repository");
      }

      await ctx.db
        .update(projects)
        .set({ forgeRepositoryId: repo.id })
        .where(eq(projects.id, project.id));

      return repo;
    }),

  list: protectedProcedure
    .input(forgeRepositoryListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(forgeRepositories)
        .where(eq(forgeRepositories.workspaceId, input.workspaceId))
        .orderBy(desc(forgeRepositories.updatedAt));
    }),

  getBookmarks: protectedProcedure
    .input(forgeRepositoryBookmarksInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          revId: forgeRevisions.revId,
          bookmarks: forgeRevisions.bookmarks,
          indexedAt: forgeRevisions.indexedAt,
        })
        .from(forgeRevisions)
        .where(eq(forgeRevisions.repoId, input.repoId))
        .orderBy(desc(forgeRevisions.indexedAt))
        .limit(input.limit);
    }),
});
