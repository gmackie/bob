import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "@bob/db";
import { requirements, workItems, workspaceMembers } from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const categorySchema = z.enum([
  "data",
  "api",
  "ui",
  "infra",
  "test",
  "other",
]);
const statusSchema = z.enum(["pending", "in_progress", "done"]);

async function assertWorkItemAccess(db: any, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { workspaceId: true },
  });

  if (!workItem) {
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

async function assertRequirementAccess(
  db: any,
  userId: string,
  requirementId: string,
) {
  const requirement = await db.query.requirements.findFirst({
    where: eq(requirements.id, requirementId),
    columns: { workItemId: true },
  });

  if (!requirement) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkItemAccess(db, userId, requirement.workItemId);
}

export const requirementRouter = {
  list: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkItemAccess(ctx.db, ctx.session.user.id, input.workItemId);

      const rows = await ctx.db
        .select()
        .from(requirements)
        .where(eq(requirements.workItemId, input.workItemId))
        .orderBy(asc(requirements.category), asc(requirements.sortOrder));

      // Group by category with completion counts
      const categories = new Map<
        string,
        { items: typeof rows; total: number; done: number }
      >();

      for (const row of rows) {
        let group = categories.get(row.category);
        if (!group) {
          group = { items: [], total: 0, done: 0 };
          categories.set(row.category, group);
        }
        group.items.push(row);
        group.total++;
        if (row.status === "done") group.done++;
      }

      return Object.fromEntries(categories);
    }),

  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        category: categorySchema,
        description: z.string().min(1),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkItemAccess(ctx.db, ctx.session.user.id, input.workItemId);

      const [requirement] = await ctx.db
        .insert(requirements)
        .values({
          workItemId: input.workItemId,
          category: input.category,
          description: input.description,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return requirement;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).optional(),
        status: statusSchema.optional(),
        category: categorySchema.optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await assertRequirementAccess(ctx.db, ctx.session.user.id, id);

      // Filter out undefined values
      const setValues: Record<string, unknown> = {};
      if (updates.description !== undefined)
        setValues.description = updates.description;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.category !== undefined) setValues.category = updates.category;
      if (updates.sortOrder !== undefined)
        setValues.sortOrder = updates.sortOrder;

      const [updated] = await ctx.db
        .update(requirements)
        .set(setValues)
        .where(eq(requirements.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertRequirementAccess(ctx.db, ctx.session.user.id, input.id);

      await ctx.db.delete(requirements).where(eq(requirements.id, input.id));
      return { success: true };
    }),

  linkToTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        taskId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRequirementAccess(ctx.db, ctx.session.user.id, input.id);

      const [updated] = await ctx.db
        .update(requirements)
        .set({ linkedTaskId: input.taskId })
        .where(eq(requirements.id, input.id))
        .returning();
      return updated;
    }),
} satisfies TRPCRouterRecord;
