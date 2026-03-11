import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { issueArtifacts, issues } from "@linear-clone/db";

import { protectedProcedure, router } from "../trpc";

const executionBackendEnum = z.enum(["bob"]);
const producerTypeEnum = z.enum(["bob", "forgegraph", "human", "system"]);
const artifactTypeEnum = z.enum([
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "other",
]);

export const issueArtifactRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        agentTaskRunId: z.string().uuid().optional(),
        executionBackend: executionBackendEnum.default("bob"),
        producerType: producerTypeEnum,
        producerId: z.string().optional(),
        artifactType: artifactTypeEnum,
        artifactRole: z.string().min(1),
        url: z.string().url(),
        title: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingArtifacts = await ctx.db
        .select()
        .from(issueArtifacts)
        .where(eq(issueArtifacts.issueId, input.issueId));

      const duplicateArtifact =
        input.producerId == null
          ? null
          : existingArtifacts.find(
              (artifact) =>
                artifact.producerType === input.producerType &&
                artifact.producerId === input.producerId
            );

      if (duplicateArtifact) {
        return duplicateArtifact;
      }

      const currentArtifactsForRole = existingArtifacts.filter(
        (artifact) =>
          artifact.artifactRole === input.artifactRole && artifact.isCurrent
      );

      if (currentArtifactsForRole.length > 0) {
        await ctx.db
          .update(issueArtifacts)
          .set({ isCurrent: false })
          .where(
            and(
              eq(issueArtifacts.issueId, input.issueId),
              eq(issueArtifacts.artifactRole, input.artifactRole),
              eq(issueArtifacts.isCurrent, true)
            )
          )
          .returning();
      }

      const [created] = await ctx.db
        .insert(issueArtifacts)
        .values({
          issueId: input.issueId,
          agentTaskRunId: input.agentTaskRunId ?? null,
          executionBackend: input.executionBackend,
          producerType: input.producerType,
          producerId: input.producerId,
          artifactType: input.artifactType,
          artifactRole: input.artifactRole,
          url: input.url,
          title: input.title,
          summary: input.summary,
          metadata: input.metadata,
          isCurrent: true,
        })
        .returning();

      return created;
    }),

  listCurrent: protectedProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const artifacts = await ctx.db
        .select()
        .from(issueArtifacts)
        .where(eq(issueArtifacts.issueId, input.issueId));

      return artifacts.filter((artifact) => artifact.isCurrent);
    }),

  listGroupedChildArtifacts: protectedProcedure
    .input(z.object({ parentIssueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const childIssues = await ctx.db
        .select()
        .from(issues)
        .where(eq(issues.parentId, input.parentIssueId));

      const groups = await Promise.all(
        childIssues.map(async (childIssue) => {
          const artifacts = await ctx.db
            .select()
            .from(issueArtifacts)
            .where(eq(issueArtifacts.issueId, childIssue.id));

          return {
            issue: childIssue,
            artifacts: artifacts.filter((artifact) => artifact.isCurrent),
          };
        })
      );

      return groups.filter((group) => group.artifacts.length > 0);
    }),
});
