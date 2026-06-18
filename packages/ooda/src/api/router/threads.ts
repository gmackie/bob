import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { desc, eq } from "@gmacko/ooda/db";
import {
  researchThread,
  CreateResearchThreadSchema,
} from "@gmacko/ooda/db/schema";
import { readNotes } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";
import {
  listDomainPacks as listPacks,
  getDomainPackTemplate,
} from "@gmacko/ooda/domain-packs";

import { publicProcedure, authedProcedure } from "../trpc";

export const threadsRouter = {
  list: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads", tags: ["threads"] } })
    .output(z.any())
    .query(({ ctx }) => {
    return ctx.db.query.researchThread.findMany({
      orderBy: desc(researchThread.createdAt),
      limit: 50,
    });
  }),

  byId: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/by-id", tags: ["threads"] } })
    .input(z.object({ id: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.researchThread.findFirst({
        where: eq(researchThread.id, input.id),
      });
    }),

  bySlug: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/by-slug", tags: ["threads"] } })
    .input(z.object({ slug: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.researchThread.findFirst({
        where: eq(researchThread.slug, input.slug),
      });
    }),

  create: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/threads", tags: ["threads"], protect: true } })
    .input(CreateResearchThreadSchema)
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .insert(researchThread)
        .values({ ...input, ownerId: ctx.userId })
        .returning();

      const storageRoot =
        process.env.OODA_STORAGE_ROOT ?? join(homedir(), ".ooda", "threads");
      const { createThreadWorkspace } = await import("@gmacko/ooda/thread-workspace");
      await createThreadWorkspace({
        storageRoot,
        slug: input.slug,
        title: input.title,
        domainPackId: input.domainPackId ?? undefined,
      });

      return result;
    }),

  sync: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/threads/sync", tags: ["threads"], protect: true } })
    .output(z.any())
    .mutation(async ({ ctx }) => {
    const storageRoot =
      process.env.OODA_STORAGE_ROOT ?? join(homedir(), ".ooda", "threads");

    const { pullVault, scanThreads } = await import("@gmacko/ooda/thread-workspace");

    const pullResult = await pullVault(storageRoot);

    if (!pullResult.conflicts) {
      const threads = scanThreads(storageRoot);
      for (const t of threads) {
        await ctx.db
          .insert(researchThread)
          .values({
            title: t.title,
            slug: t.slug,
            domainPackId: t.domainPackId,
            ownerId: ctx.userId,
          })
          .onConflictDoUpdate({
            target: researchThread.slug,
            set: { title: t.title },
          });
      }
    }

    return {
      filesChanged: pullResult.filesChanged,
      conflicts: pullResult.conflicts,
      conflictFiles: pullResult.conflictFiles,
    };
  }),

  updateStatus: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/threads/update-status", tags: ["threads"], protect: true } })
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["active", "paused", "archived", "completed"]),
      }),
    )
    .output(z.any())
    .mutation(({ ctx, input }) => {
      return ctx.db
        .update(researchThread)
        .set({ status: input.status })
        .where(eq(researchThread.id, input.id))
        .returning();
    }),

  listNotes: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/notes", tags: ["threads"] } })
    .input(z.object({ slug: z.string() }))
    .output(z.any())
    .query(({ input }) => {
      const storageRoot =
        process.env.OODA_STORAGE_ROOT ??
        join(homedir(), ".ooda", "threads");

      try {
        const threadDir = resolveThreadPath(storageRoot, input.slug);
        if (!existsSync(threadDir)) return [];
        return readNotes(threadDir);
      } catch {
        return [];
      }
    }),

  listDomainPacks: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/domain-packs", tags: ["threads"] } })
    .output(z.any())
    .query(() => {
    return listPacks().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      warnings: p.warnings,
    }));
  }),

  getDomainPackTemplate: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/domain-pack-template", tags: ["threads"] } })
    .input(z.object({ packId: z.string() }))
    .output(z.any())
    .query(({ input }) => {
      return getDomainPackTemplate(input.packId) ?? null;
    }),
} satisfies RouterRecord;
