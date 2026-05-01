/**
 * Edge-compatible subset of the threads router.
 *
 * Includes only DB-backed procedures that have no filesystem, git, or
 * node:os / node:fs dependencies — safe to run on Cloudflare Workers.
 *
 * Excluded (filesystem-dependent):
 *   create          — createThreadWorkspace() (mkdir)
 *   sync            — pullVault(), scanThreads() (git + fs)
 *   listNotes       — readNotes() (disk read)
 *   listDomainPacks — reads local domain pack files
 *   getDomainPackTemplate — reads local domain pack templates
 */

import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import { desc, eq } from "@gmacko/ooda/db";
import { researchThread } from "@gmacko/ooda/db/schema";

import { publicProcedure, authedProcedure } from "../trpc";

export const threadsEdgeRouter = {
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
} satisfies RouterRecord;
