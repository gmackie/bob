import { z } from "zod";
import { eq, and, asc, isNull, desc } from "drizzle-orm";
import {
  agentTaskRuns,
  comments,
  commentReactions,
  users,
  activities,
  issues,
  issueSubscribers,
  projects,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";
import { dispatchWebhook, buildIssuePayload } from "../services/outbound-webhook";

const bobMentionPattern = /(^|[\s(])@?bob\b/i;

const createCommentInput = z.object({
  issueId: z.string().uuid(),
  body: z.string().min(1).max(10000),
  bodyHtml: z.string().optional(),
  parentId: z.string().uuid().optional(),
});

const updateCommentInput = z.object({
  id: z.string().uuid(),
  body: z.string().min(1).max(10000),
  bodyHtml: z.string().optional(),
});

export interface BobCommentRoutingMetadata {
  shouldRoute: boolean;
  reason: "prompt_reply" | "mention";
  issueManaged: boolean;
  promptCommentId: string | null;
  taskRunId: string | null;
  sessionId: string | null;
}

export function buildBobCommentRoutingMetadata(input: {
  body: string;
  parentId?: string | null;
  issueStatus: string;
  lastPromptCommentId?: string | null;
  taskRunId?: string | null;
  sessionId?: string | null;
  hasActiveBobRun: boolean;
}): BobCommentRoutingMetadata {
  const isPromptReply =
    Boolean(input.parentId) && input.parentId === input.lastPromptCommentId;
  const mentionsBob = bobMentionPattern.test(input.body);
  const shouldRoute = input.hasActiveBobRun && (isPromptReply || mentionsBob);

  return {
    shouldRoute,
    reason: isPromptReply ? "prompt_reply" : "mention",
    issueManaged:
      input.hasActiveBobRun &&
      (input.issueStatus === "in_review" ||
        input.issueStatus === "in_progress" ||
        input.issueStatus === "blocked"),
    promptCommentId: input.lastPromptCommentId ?? null,
    taskRunId: input.taskRunId ?? null,
    sessionId: input.sessionId ?? null,
  };
}

export const commentRouter = router({
  // List comments for an issue
  list: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        includeReplies: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get top-level comments
      const topLevelComments = await ctx.db
        .select({
          comment: comments,
          user: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(and(eq(comments.issueId, input.issueId), isNull(comments.parentId)))
        .orderBy(asc(comments.createdAt));

      if (!input.includeReplies) {
        // Get reactions for top-level comments
        const commentIds = topLevelComments.map((c) => c.comment.id);
        const reactions = await ctx.db
          .select({
            commentId: commentReactions.commentId,
            emoji: commentReactions.emoji,
            userId: commentReactions.userId,
          })
          .from(commentReactions)
          .where(
            commentIds.length > 0
              ? eq(commentReactions.commentId, commentIds[0]!) // simplified for now
              : eq(commentReactions.commentId, "00000000-0000-0000-0000-000000000000")
          );

        return topLevelComments.map((c) => ({
          ...c.comment,
          user: c.user,
          reactions: reactions.filter((r) => r.commentId === c.comment.id),
          replies: [],
        }));
      }

      // Get all replies
      const replies = await ctx.db
        .select({
          comment: comments,
          user: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(
          and(
            eq(comments.issueId, input.issueId),
            // Filter for replies (has parentId)
            eq(comments.parentId, comments.parentId) // This will be handled below
          )
        )
        .orderBy(asc(comments.createdAt));

      // Filter replies that have parents
      const allComments = [...topLevelComments, ...replies];
      const repliesOnly = allComments.filter((c) => c.comment.parentId !== null);

      // Get all reactions
      const allCommentIds = allComments.map((c) => c.comment.id);
      const reactions =
        allCommentIds.length > 0
          ? await ctx.db.select().from(commentReactions).where(eq(commentReactions.commentId, allCommentIds[0]!))
          : [];

      // Group reactions by comment
      const reactionsByComment = new Map<string, typeof reactions>();
      for (const r of reactions) {
        const existing = reactionsByComment.get(r.commentId) ?? [];
        existing.push(r);
        reactionsByComment.set(r.commentId, existing);
      }

      // Group replies by parent
      const repliesByParent = new Map<string, typeof topLevelComments>();
      for (const reply of repliesOnly) {
        if (reply.comment.parentId) {
          const existing = repliesByParent.get(reply.comment.parentId) ?? [];
          existing.push(reply);
          repliesByParent.set(reply.comment.parentId, existing);
        }
      }

      return topLevelComments.map((c) => ({
        ...c.comment,
        user: c.user,
        reactions: reactionsByComment.get(c.comment.id) ?? [],
        replies: (repliesByParent.get(c.comment.id) ?? []).map((r) => ({
          ...r.comment,
          user: r.user,
          reactions: reactionsByComment.get(r.comment.id) ?? [],
        })),
      }));
    }),

  // Get a single comment
  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [result] = await ctx.db
      .select({
        comment: comments,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(comments)
      .innerJoin(users, eq(comments.userId, users.id))
      .where(eq(comments.id, input.id))
      .limit(1);

    return result ? { ...result.comment, user: result.user } : null;
  }),

  // Create a comment
  create: protectedProcedure.input(createCommentInput).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    // Create comment
    const [comment] = await ctx.db
      .insert(comments)
      .values({
        issueId: input.issueId,
        userId: user.id,
        parentId: input.parentId,
        body: input.body,
        bodyHtml: input.bodyHtml,
      })
      .returning();

    if (!comment) {
      throw new Error("Failed to create comment");
    }

    // Create activity record
    await ctx.db.insert(activities).values({
      issueId: input.issueId,
      userId: user.id,
      type: "comment_added",
      metadata: { commentId: comment.id },
    });

    // Auto-subscribe commenter to issue
    await ctx.db
      .insert(issueSubscribers)
      .values({
        issueId: input.issueId,
        userId: user.id,
      })
      .onConflictDoNothing();

    // Update issue's updatedAt
    await ctx.db
      .update(issues)
      .set({ updatedAt: new Date() })
      .where(eq(issues.id, input.issueId));

    const [issue] = await ctx.db
      .select()
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .limit(1);

    if (issue) {
      const [project] = await ctx.db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .limit(1);

      if (project) {
        const [latestBobRun] = await ctx.db
          .select({
            id: agentTaskRuns.id,
            sessionId: agentTaskRuns.sessionId,
            status: agentTaskRuns.status,
            lastPromptCommentId: agentTaskRuns.lastPromptCommentId,
          })
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.issueId, input.issueId),
              eq(agentTaskRuns.executionBackend, "bob"),
            ),
          )
          .orderBy(desc(agentTaskRuns.claimedAt))
          .limit(1);

        const hasActiveBobRun =
          latestBobRun?.status === "claimed" ||
          latestBobRun?.status === "in_progress";
        const bobRouting = buildBobCommentRoutingMetadata({
          body: input.body,
          parentId: input.parentId,
          issueStatus: issue.status,
          lastPromptCommentId: latestBobRun?.lastPromptCommentId,
          taskRunId: latestBobRun?.id,
          sessionId: latestBobRun?.sessionId,
          hasActiveBobRun,
        });

        dispatchWebhook(
          ctx.db,
          project.workspaceId,
          issue.projectId,
          "comment.created",
          buildIssuePayload(issue),
          undefined,
          {
            comment: {
              id: comment.id,
              parentId: comment.parentId ?? null,
              body: comment.body,
              createdAt: comment.createdAt.toISOString(),
              user: {
                id: user.id,
                name: user.name ?? user.email ?? "Unknown user",
                email: user.email ?? "",
              },
            },
            bobRouting,
          },
        ).catch(() => {});
      }
    }

    return comment;
  }),

  // Update a comment
  update: protectedProcedure.input(updateCommentInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [comment] = await ctx.db
      .update(comments)
      .set({
        ...data,
        edited: true,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id))
      .returning();

    return comment;
  }),

  // Delete a comment
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(comments).where(eq(comments.id, input.id));
      return { success: true };
    }),

  // Add reaction to a comment
  addReaction: protectedProcedure
    .input(
      z.object({
        commentId: z.string().uuid(),
        emoji: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      const [reaction] = await ctx.db
        .insert(commentReactions)
        .values({
          commentId: input.commentId,
          userId: user.id,
          emoji: input.emoji,
        })
        .returning();

      return reaction;
    }),

  // Remove reaction from a comment
  removeReaction: protectedProcedure
    .input(
      z.object({
        commentId: z.string().uuid(),
        emoji: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      await ctx.db
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, input.commentId),
            eq(commentReactions.userId, user.id),
            eq(commentReactions.emoji, input.emoji)
          )
        );

      return { success: true };
    }),
});
