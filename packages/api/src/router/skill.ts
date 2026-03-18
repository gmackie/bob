import type { TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { skillExecutions, skills } from "@bob/db/schema";
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
    .query(async ({ input }) => {
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

      // Fetch parent execution if exists
      let parentExecution = null;
      if (row.execution.parentExecutionId) {
        const parents = await db
          .select()
          .from(skillExecutions)
          .where(eq(skillExecutions.id, row.execution.parentExecutionId))
          .limit(1);
        parentExecution = parents[0] ?? null;
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
    .query(async ({ input }) => {
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
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
