import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  skillExecutions,
  skills,
  workItems,
  workspaceMembers,
} from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const categorySchema = z.enum([
  "planning",
  "execution",
  "review",
  "deploy",
  "ops",
  "other",
]);
const sourceSchema = z.enum(["builtin", "gstack", "custom"]);
const statusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

async function assertConversationAccess(userId: string, sessionId: string) {
  const conversation = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
    columns: { id: true },
  });

  if (!conversation) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function assertWorkItemAccess(userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workItem.workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function loadExecutionById(executionId: string) {
  const rows = await db
    .select()
    .from(skillExecutions)
    .where(eq(skillExecutions.id, executionId))
    .limit(1);

  return rows[0] ?? null;
}

async function assertExecutionAccess(userId: string, execution: {
  id: string;
  sessionId: string | null;
  workItemId: string | null;
  parentExecutionId: string | null;
}) {
  if (execution.sessionId) {
    await assertConversationAccess(userId, execution.sessionId);
    return;
  }

  if (execution.workItemId) {
    await assertWorkItemAccess(userId, execution.workItemId);
    return;
  }

  if (execution.parentExecutionId) {
    const parent = await loadExecutionById(execution.parentExecutionId);
    if (!parent) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    await assertExecutionAccess(userId, parent);
    return;
  }

  throw new TRPCError({ code: "NOT_FOUND" });
}

async function loadAccessibleExecution(userId: string, executionId: string) {
  const execution = await loadExecutionById(executionId);
  if (!execution) {
    return null;
  }

  await assertExecutionAccess(userId, execution);
  return execution;
}

/** Built-in skills seeded on first `list` call. */
const BUILTIN_SKILLS = [
  {
    slug: "review",
    name: "Code Review",
    category: "review" as const,
    source: "builtin" as const,
    description: "Review code changes for quality and correctness",
  },
  {
    slug: "ship",
    name: "Ship Code",
    category: "deploy" as const,
    source: "builtin" as const,
    description: "Ship code changes through the deployment pipeline",
  },
  {
    slug: "qa",
    name: "QA Testing",
    category: "review" as const,
    source: "builtin" as const,
    description: "Run QA testing on changes",
  },
  {
    slug: "brainstorm",
    name: "Brainstorm",
    category: "planning" as const,
    source: "builtin" as const,
    description: "Brainstorm ideas and approaches",
  },
  {
    slug: "browse",
    name: "Web Browse",
    category: "ops" as const,
    source: "gstack" as const,
    description: "Browse the web for information",
  },
  {
    slug: "tdd",
    name: "Test-Driven Development",
    category: "execution" as const,
    source: "builtin" as const,
    description: "Write tests first, then implementation",
  },
  {
    slug: "retro",
    name: "Retrospective",
    category: "review" as const,
    source: "gstack" as const,
    description: "Run a retrospective on completed work",
  },
  {
    slug: "plan-ceo-review",
    name: "CEO Plan Review",
    category: "planning" as const,
    source: "gstack" as const,
    description: "CEO-level plan review",
  },
  {
    slug: "plan-eng-review",
    name: "Engineering Plan Review",
    category: "planning" as const,
    source: "gstack" as const,
    description: "Engineering plan review",
  },
  {
    slug: "plan-design-review",
    name: "Design Plan Review",
    category: "planning" as const,
    source: "gstack" as const,
    description: "Design plan review",
  },
];

export const skillRouter = {
  list: protectedProcedure
    .input(
      z
        .object({
          category: categorySchema.optional(),
          source: sourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.category) {
        conditions.push(eq(skills.category, input.category));
      }
      if (input?.source) {
        conditions.push(eq(skills.source, input.source));
      }

      const rows = await db
        .select()
        .from(skills)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return rows;
    }),

  seed: protectedProcedure.mutation(async () => {
    let seeded = 0;
    for (const skill of BUILTIN_SKILLS) {
      const existing = await db
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.slug, skill.slug))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(skills).values(skill);
        seeded++;
      }
    }
    return { seeded, total: BUILTIN_SKILLS.length };
  }),

  getExecution: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          execution: skillExecutions,
          skillName: skills.name,
        })
        .from(skillExecutions)
        .leftJoin(skills, eq(skillExecutions.skillId, skills.id))
        .where(eq(skillExecutions.id, input.id))
        .limit(1);

      if (rows.length === 0) return null;

      const row = rows[0]!;
      await assertExecutionAccess(ctx.session.user.id, row.execution);

      // Fetch parent execution if exists
      let parentExecution = null;
      if (row.execution.parentExecutionId) {
        parentExecution = await loadAccessibleExecution(
          ctx.session.user.id,
          row.execution.parentExecutionId,
        );
      }

      return {
        ...row.execution,
        skillName: row.skillName,
        parentExecution,
      };
    }),

  listExecutions: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        workItemId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.sessionId) {
        await assertConversationAccess(ctx.session.user.id, input.sessionId);
      }
      if (input.workItemId) {
        await assertWorkItemAccess(ctx.session.user.id, input.workItemId);
      }

      const conditions = [];
      if (input.sessionId) {
        conditions.push(eq(skillExecutions.sessionId, input.sessionId));
      }
      if (input.workItemId) {
        conditions.push(eq(skillExecutions.workItemId, input.workItemId));
      }

      if (conditions.length === 0) {
        return [];
      }

      const rows = await db
        .select({
          execution: skillExecutions,
          skillName: skills.name,
        })
        .from(skillExecutions)
        .leftJoin(skills, eq(skillExecutions.skillId, skills.id))
        .where(and(...conditions))
        .orderBy(desc(skillExecutions.startedAt));

      return rows.map((r) => ({
        ...r.execution,
        skillName: r.skillName,
      }));
    }),

  recordExecution: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        skillId: z.string().uuid().optional(),
        skillSlug: z.string(),
        workItemId: z.string().uuid().optional(),
        parentExecutionId: z.string().uuid().optional(),
        status: statusSchema.optional(),
        input: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId) {
        await assertConversationAccess(ctx.session.user.id, input.sessionId);
      }
      if (input.workItemId) {
        await assertWorkItemAccess(ctx.session.user.id, input.workItemId);
      }
      if (input.parentExecutionId) {
        const parent = await loadAccessibleExecution(
          ctx.session.user.id,
          input.parentExecutionId,
        );
        if (!parent) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      }
      if (!input.sessionId && !input.workItemId && !input.parentExecutionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Skill execution must be scoped to a session, work item, or parent execution",
        });
      }

      const [execution] = await db
        .insert(skillExecutions)
        .values({
          sessionId: input.sessionId,
          skillId: input.skillId,
          skillSlug: input.skillSlug,
          workItemId: input.workItemId,
          parentExecutionId: input.parentExecutionId,
          status: input.status ?? "running",
          input: input.input ?? {},
        })
        .returning();
      return execution;
    }),

  updateExecution: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusSchema.optional(),
        output: z.record(z.string(), z.unknown()).optional(),
        findings: z.array(z.unknown()).optional(),
        completedAt: z.coerce.date().optional(),
        durationMs: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const execution = await loadAccessibleExecution(ctx.session.user.id, id);

      if (!execution) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const setValues: Record<string, unknown> = {};
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.output !== undefined) setValues.output = updates.output;
      if (updates.findings !== undefined) setValues.findings = updates.findings;
      if (updates.completedAt !== undefined)
        setValues.completedAt = updates.completedAt;
      if (updates.durationMs !== undefined)
        setValues.durationMs = updates.durationMs;

      const [updated] = await db
        .update(skillExecutions)
        .set(setValues)
        .where(eq(skillExecutions.id, id))
        .returning();
      return updated;
    }),
} satisfies TRPCRouterRecord;
