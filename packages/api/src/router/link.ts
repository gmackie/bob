import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and } from "@bob/db";
import {
  worktreeLinks,
  worktrees,
  CreateWorktreeLinkSchema,
  linkTypeEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const linkRouter = {
  list: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        linkType: z.enum(linkTypeEnum).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(worktreeLinks.userId, ctx.session.user.id)];
      if (input.worktreeId) {
        conditions.push(eq(worktreeLinks.worktreeId, input.worktreeId));
      }
      if (input.linkType) {
        conditions.push(eq(worktreeLinks.linkType, input.linkType));
      }

      const links = await ctx.db.query.worktreeLinks.findMany({
        where: and(...conditions),
        orderBy: desc(worktreeLinks.createdAt),
        with: {
          worktree: true,
        },
      });
      return links;
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const link = await ctx.db.query.worktreeLinks.findFirst({
        where: and(
          eq(worktreeLinks.id, input.id),
          eq(worktreeLinks.userId, ctx.session.user.id)
        ),
        with: {
          worktree: true,
        },
      });

      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
      }

      return link;
    }),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const links = await ctx.db.query.worktreeLinks.findMany({
        where: eq(worktreeLinks.worktreeId, input.worktreeId),
        orderBy: desc(worktreeLinks.createdAt),
      });

      return links;
    }),

  create: protectedProcedure
    .input(CreateWorktreeLinkSchema)
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const [link] = await ctx.db
        .insert(worktreeLinks)
        .values({
          ...input,
          userId: ctx.session.user.id,
        })
        .returning();

      return link;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        externalId: z.string().max(256).optional(),
        url: z.string().url().optional(),
        title: z.string().max(256).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const existing = await ctx.db.query.worktreeLinks.findFirst({
        where: and(
          eq(worktreeLinks.id, id),
          eq(worktreeLinks.userId, ctx.session.user.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
      }

      const [updated] = await ctx.db
        .update(worktreeLinks)
        .set(updates)
        .where(eq(worktreeLinks.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(worktreeLinks)
        .where(
          and(
            eq(worktreeLinks.id, input.id),
            eq(worktreeLinks.userId, ctx.session.user.id)
          )
        );
      return { success: true };
    }),

  linkToKanbanger: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        taskId: z.string(),
        taskUrl: z.string().url().optional(),
        taskTitle: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const existing = await ctx.db.query.worktreeLinks.findFirst({
        where: and(
          eq(worktreeLinks.worktreeId, input.worktreeId),
          eq(worktreeLinks.linkType, "kanbanger_task"),
          eq(worktreeLinks.externalId, input.taskId)
        ),
      });

      if (existing) {
        return existing;
      }

      const [link] = await ctx.db
        .insert(worktreeLinks)
        .values({
          worktreeId: input.worktreeId,
          userId: ctx.session.user.id,
          linkType: "kanbanger_task",
          externalId: input.taskId,
          url: input.taskUrl,
          title: input.taskTitle,
        })
        .returning();

      return link;
    }),

  linkToGitHubPR: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        prNumber: z.number(),
        prUrl: z.string().url(),
        prTitle: z.string(),
        repoOwner: z.string(),
        repoName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const externalId = `${input.repoOwner}/${input.repoName}#${input.prNumber}`;

      const existing = await ctx.db.query.worktreeLinks.findFirst({
        where: and(
          eq(worktreeLinks.worktreeId, input.worktreeId),
          eq(worktreeLinks.linkType, "github_pr"),
          eq(worktreeLinks.externalId, externalId)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(worktreeLinks)
          .set({
            url: input.prUrl,
            title: input.prTitle,
            metadata: {
              prNumber: input.prNumber,
              repoOwner: input.repoOwner,
              repoName: input.repoName,
            },
          })
          .where(eq(worktreeLinks.id, existing.id))
          .returning();
        return updated;
      }

      const [link] = await ctx.db
        .insert(worktreeLinks)
        .values({
          worktreeId: input.worktreeId,
          userId: ctx.session.user.id,
          linkType: "github_pr",
          externalId,
          url: input.prUrl,
          title: input.prTitle,
          metadata: {
            prNumber: input.prNumber,
            repoOwner: input.repoOwner,
            repoName: input.repoName,
          },
        })
        .returning();

      return link;
    }),
} satisfies TRPCRouterRecord;
