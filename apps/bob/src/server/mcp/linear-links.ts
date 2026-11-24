import { and, desc, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { mcpLinearLinks as links, workItems } from "@bob/db/schema";
import { z } from "zod/v4";
import { McpToolError } from "./errors";

const readActions = z.enum(["get", "list"]);
export const linkSchema = z.strictObject({
  action: z.enum(["get", "list", "upsert", "remove"]),
  bobWorkItemId: z.string().uuid().optional(),
  linearIssueId: z.string().min(1).max(256).optional(),
  linearProjectId: z.string().min(1).max(256).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(100),
});
export const readLinkSchema = linkSchema.extend({ action: readActions });

function view(row: typeof links.$inferSelect) {
  return {
    bobWorkItemId: row.workItemId,
    linearIssueId: row.linearIssueId,
    ...(row.linearProjectId ? { linearProjectId: row.linearProjectId } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function linearLinks(db: Db, workspaceId: string, input: z.infer<typeof linkSchema>) {
  if (input.action === "list") {
    const rows = await db
      .select({ link: links })
      .from(links)
      .innerJoin(
        workItems,
        and(eq(workItems.id, links.workItemId), eq(workItems.workspaceId, links.workspaceId)),
      )
      .where(eq(links.workspaceId, workspaceId))
      .orderBy(desc(links.updatedAt), links.workItemId)
      .offset(input.offset)
      .limit(input.limit + 1);
    return {
      links: rows.slice(0, input.limit).map(({ link }) => view(link)),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    };
  }
  const workItemId = input.bobWorkItemId;
  if (!workItemId) throw new McpToolError("bobWorkItemId is required");
  const itemWhere = and(eq(workItems.id, workItemId), eq(workItems.workspaceId, workspaceId));
  const linkWhere = and(eq(links.workspaceId, workspaceId), eq(links.workItemId, workItemId));
  if (input.action === "get") {
    const [row] = await db
      .select({ link: links })
      .from(workItems)
      .leftJoin(links, linkWhere)
      .where(itemWhere);
    if (!row) throw new McpToolError("Work item not found");
    return { link: row.link ? view(row.link) : null };
  }
  return db.transaction(async (tx) => {
    // Lock the item even for a first insert, so concurrent edits report the
    // actual previous link and an item cannot change workspace mid-write.
    const [item] = await tx
      .select({ id: workItems.id })
      .from(workItems)
      .where(itemWhere)
      .for("update");
    if (!item) throw new McpToolError("Work item not found");
    if (input.action === "remove") {
      await tx.delete(links).where(linkWhere);
      return { removed: true };
    }
    if (!input.linearIssueId) throw new McpToolError("linearIssueId is required for upsert");
    const [previous] = await tx.select().from(links).where(linkWhere);
    const values = {
      linearIssueId: input.linearIssueId,
      linearProjectId: input.linearProjectId ?? null,
    };
    if (
      previous?.linearIssueId === values.linearIssueId &&
      previous.linearProjectId === values.linearProjectId
    )
      return { kind: "unchanged", link: view(previous) };
    const [row] = await tx
      .insert(links)
      .values({ workspaceId, workItemId, ...values })
      .onConflictDoUpdate({
        target: [links.workspaceId, links.workItemId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Link update failed");
    return previous
      ? { kind: "replace", previous: view(previous), link: view(row) }
      : { kind: "create", link: view(row) };
  });
}
