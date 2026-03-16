/**
 * Planning tool handler for the gateway.
 *
 * When the planning agent (Claude) calls tools like `create_draft_task`,
 * the gateway intercepts those tool calls and executes them directly
 * against the database, then returns the result to the agent.
 */

import { and, eq, inArray, asc } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  planDrafts,
  planDraftDependencies,
} from "@bob/db/schema";
import {
  mapPlanningToolCall,
  type PlanningContext,
  type PlanningToolCall,
} from "@bob/execution/planning/planningAgentTools";

const PLANNING_TOOL_NAMES = new Set([
  "create_draft_task",
  "update_draft_task",
  "remove_draft_task",
  "set_dependency",
  "remove_dependency",
  "list_drafts",
]);

/** Check whether a tool name is a planning tool that this handler manages. */
export function isPlanningTool(toolName: string): boolean {
  return PLANNING_TOOL_NAMES.has(toolName);
}

interface ToolCallInput {
  name: string;
  args: Record<string, unknown>;
}

interface SessionInfo {
  id: string;
  userId: string;
}

/**
 * Handle a planning tool call from the agent.
 *
 * Looks up the session to get workspace/project context, maps the tool call
 * to a direct DB operation, executes it, and returns a string result.
 */
export async function handlePlanningToolCall(
  toolCall: ToolCallInput,
  sessionRecord: SessionInfo,
): Promise<string> {
  try {
    // Load the planning context from the session's existing drafts or conversation
    const ctx = await loadPlanningContext(sessionRecord.id);
    if (!ctx) {
      return "Error: Could not load planning context for this session. Is this a planning session?";
    }

    // Handle list_drafts separately — it's a query, not in mapPlanningToolCall
    if (toolCall.name === "list_drafts") {
      return await handleListDrafts(ctx.sessionId);
    }

    // Map the tool call to a procedure + input
    const mapped = mapPlanningToolCall(
      { tool: toolCall.name, args: toolCall.args } as PlanningToolCall,
      ctx,
    );

    if (!mapped) {
      return `Error: Unknown planning tool "${toolCall.name}"`;
    }

    switch (mapped.procedure) {
      case "createDraft":
        return await handleCreateDraft(mapped.input);
      case "updateDraft":
        return await handleUpdateDraft(mapped.input);
      case "removeDraft":
        return await handleRemoveDraft(mapped.input);
      case "setDependency":
        return await handleSetDependency(mapped.input);
      case "removeDependency":
        return await handleRemoveDependency(mapped.input);
      default:
        return `Error: Unhandled procedure "${(mapped as { procedure: string }).procedure}"`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[planningToolHandler] Error handling ${toolCall.name}:`,
      error,
    );
    return `Error: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Context loader
// ---------------------------------------------------------------------------

async function loadPlanningContext(
  sessionId: string,
): Promise<PlanningContext | null> {
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.sessionType, "planning"),
    ),
  });

  if (!session) return null;

  // Try to get workspace/project from existing drafts
  const firstDraft = await db.query.planDrafts.findFirst({
    where: eq(planDrafts.sessionId, sessionId),
  });

  // If there are existing drafts, use their workspace/project.
  // Otherwise fall back to empty strings — the agent's tool call args
  // will supply workspace/project via mapPlanningToolCall context injection.
  return {
    sessionId,
    workspaceId: firstDraft?.workspaceId ?? "",
    projectId: firstDraft?.projectId ?? "",
    projectName: session.title ?? "Unknown project",
  };
}

// ---------------------------------------------------------------------------
// Individual tool handlers
// ---------------------------------------------------------------------------

async function handleCreateDraft(
  input: Record<string, unknown>,
): Promise<string> {
  const [draft] = await db
    .insert(planDrafts)
    .values({
      sessionId: input.sessionId as string,
      workspaceId: input.workspaceId as string,
      projectId: input.projectId as string,
      title: input.title as string,
      description: (input.description as string) ?? null,
      kind: (input.kind as "task" | "issue" | "epic") ?? "task",
      priority: (input.priority as string) ?? "no_priority",
      sortOrder: (input.sortOrder as number) ?? 0,
    })
    .returning();

  if (!draft) {
    return "Error: Failed to create draft";
  }

  return `Created draft task "${draft.title}" (id: ${draft.id})`;
}

async function handleUpdateDraft(
  input: Record<string, unknown>,
): Promise<string> {
  const id = input.id as string;

  // Build update object from non-undefined fields
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.kind !== undefined) updates.kind = input.kind;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  if (Object.keys(updates).length === 0) {
    return "No fields to update.";
  }

  const [draft] = await db
    .update(planDrafts)
    .set(updates)
    .where(eq(planDrafts.id, id))
    .returning();

  if (!draft) {
    return `Error: Draft with id "${id}" not found`;
  }

  return `Updated draft "${draft.title}" (id: ${draft.id})`;
}

async function handleRemoveDraft(
  input: Record<string, unknown>,
): Promise<string> {
  const id = input.id as string;

  const [deleted] = await db
    .delete(planDrafts)
    .where(eq(planDrafts.id, id))
    .returning({ id: planDrafts.id, title: planDrafts.title });

  if (!deleted) {
    return `Error: Draft with id "${id}" not found`;
  }

  return `Removed draft "${deleted.title}" (id: ${deleted.id})`;
}

async function handleSetDependency(
  input: Record<string, unknown>,
): Promise<string> {
  const draftId = input.draftId as string;
  const dependsOnDraftId = input.dependsOnDraftId as string;

  const [dep] = await db
    .insert(planDraftDependencies)
    .values({ draftId, dependsOnDraftId })
    .returning();

  if (!dep) {
    return "Error: Failed to set dependency";
  }

  return `Set dependency: ${draftId} depends on ${dependsOnDraftId}`;
}

async function handleRemoveDependency(
  input: Record<string, unknown>,
): Promise<string> {
  const draftId = input.draftId as string;
  const dependsOnDraftId = input.dependsOnDraftId as string;

  await db
    .delete(planDraftDependencies)
    .where(
      and(
        eq(planDraftDependencies.draftId, draftId),
        eq(planDraftDependencies.dependsOnDraftId, dependsOnDraftId),
      ),
    );

  return `Removed dependency: ${draftId} no longer depends on ${dependsOnDraftId}`;
}

// ---------------------------------------------------------------------------
// list_drafts handler
// ---------------------------------------------------------------------------

async function handleListDrafts(sessionId: string): Promise<string> {
  const drafts = await db
    .select()
    .from(planDrafts)
    .where(
      and(eq(planDrafts.sessionId, sessionId), eq(planDrafts.status, "draft")),
    )
    .orderBy(asc(planDrafts.sortOrder), asc(planDrafts.createdAt));

  if (drafts.length === 0) {
    return "No draft tasks yet.";
  }

  // Load dependencies for all drafts
  const draftIds = drafts.map((d) => d.id);
  const deps = await db
    .select()
    .from(planDraftDependencies)
    .where(inArray(planDraftDependencies.draftId, draftIds));

  // Build a map of draftId -> list of dependsOnDraftId titles
  const draftTitleMap = new Map(drafts.map((d) => [d.id, d.title]));
  const depMap = new Map<string, string[]>();
  for (const dep of deps) {
    const list = depMap.get(dep.draftId) ?? [];
    const depTitle = draftTitleMap.get(dep.dependsOnDraftId);
    list.push(depTitle ?? dep.dependsOnDraftId);
    depMap.set(dep.draftId, list);
  }

  // Format as markdown table
  const header = "| # | Title | Kind | Priority | Blocked By |";
  const divider = "|---|-------|------|----------|------------|";
  const rows = drafts.map((d, i) => {
    const blockedBy = depMap.get(d.id)?.join(", ") ?? "";
    return `| ${i + 1} | ${d.title} | ${d.kind} | ${d.priority} | ${blockedBy} |`;
  });

  return [
    `**${drafts.length} draft task(s):**`,
    "",
    header,
    divider,
    ...rows,
    "",
    `Draft IDs: ${drafts.map((d) => `${d.title}: \`${d.id}\``).join(", ")}`,
  ].join("\n");
}
