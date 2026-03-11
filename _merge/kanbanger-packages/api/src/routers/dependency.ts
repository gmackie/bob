import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { issueDependencies, issues, activities } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

export const dependencyRouter = router({
  list: protectedProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const blockedByResult = await ctx.db
        .select({
          dependency: issueDependencies,
          blockingIssue: {
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            priority: issues.priority,
          },
        })
        .from(issueDependencies)
        .innerJoin(issues, eq(issueDependencies.blockingIssueId, issues.id))
        .where(eq(issueDependencies.blockedIssueId, input.issueId));

      const blockingResult = await ctx.db
        .select({
          dependency: issueDependencies,
          blockedIssue: {
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            priority: issues.priority,
          },
        })
        .from(issueDependencies)
        .innerJoin(issues, eq(issueDependencies.blockedIssueId, issues.id))
        .where(eq(issueDependencies.blockingIssueId, input.issueId));

      return {
        blockedBy: blockedByResult.map((r) => ({
          id: r.dependency.id,
          issue: r.blockingIssue,
        })),
        blocking: blockingResult.map((r) => ({
          id: r.dependency.id,
          issue: r.blockedIssue,
        })),
      };
    }),

  add: protectedProcedure
    .input(
      z.object({
        blockingIssueId: z.string().uuid(),
        blockedIssueId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      if (input.blockingIssueId === input.blockedIssueId) {
        throw new Error("An issue cannot block itself");
      }

      const existing = await ctx.db
        .select()
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.blockingIssueId, input.blockingIssueId),
            eq(issueDependencies.blockedIssueId, input.blockedIssueId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new Error("Dependency already exists");
      }

      const [dependency] = await ctx.db
        .insert(issueDependencies)
        .values({
          blockingIssueId: input.blockingIssueId,
          blockedIssueId: input.blockedIssueId,
          createdById: user.id,
        })
        .returning();

      await ctx.db.insert(activities).values({
        issueId: input.blockedIssueId,
        userId: user.id,
        type: "updated",
        metadata: { action: "dependency_added", blockingIssueId: input.blockingIssueId },
      });

      return dependency;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      const [dependency] = await ctx.db
        .select()
        .from(issueDependencies)
        .where(eq(issueDependencies.id, input.id))
        .limit(1);

      if (dependency) {
        await ctx.db.delete(issueDependencies).where(eq(issueDependencies.id, input.id));

        await ctx.db.insert(activities).values({
          issueId: dependency.blockedIssueId,
          userId: user.id,
          type: "updated",
          metadata: { action: "dependency_removed", blockingIssueId: dependency.blockingIssueId },
        });
      }

      return { success: true };
    }),

  removeByIssues: protectedProcedure
    .input(
      z.object({
        blockingIssueId: z.string().uuid(),
        blockedIssueId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(issueDependencies)
        .where(
          and(
            eq(issueDependencies.blockingIssueId, input.blockingIssueId),
            eq(issueDependencies.blockedIssueId, input.blockedIssueId)
          )
        );

      return { success: true };
    }),
});
