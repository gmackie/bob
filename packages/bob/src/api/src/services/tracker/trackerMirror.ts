/**
 * Tracker mirror — push Bob's lifecycle events for an imported work item back
 * to the tracker it came from (Linear / Kanbanger), keyed on the work item
 * rather than on a session.
 *
 * Why not `planningWriteService`? That API is session-scoped and needs a
 * task_run with planning metadata that most of the cron-driven paths (merge,
 * reaper, external close) don't have. Here we only need the work item row:
 * `external_provider`, `external_id`, `workspace_id`.
 *
 * Every write is best-effort and never throws into the caller — the tracker
 * is a mirror, not a dependency of the loop.
 */
import { LinearClient } from "@linear/sdk";

import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { workItems, workspaceIntegrations } from "@bob/db/schema";

export type MirrorEvent =
  | { kind: "claimed"; agentType: string }
  | { kind: "pr_opened"; prUrl: string }
  | { kind: "merged"; prUrl: string }
  | { kind: "pr_closed"; prUrl: string }
  | { kind: "requeued"; reason: string; attempt: number }
  | { kind: "blocked"; reason: string }
  | { kind: "deployed"; summary: string }
  | { kind: "deploy_failed"; summary: string };

export interface TrackerState {
  id: string;
  name: string;
  type: string;
}

const IN_FLIGHT = new Set(["in_progress", "in_review"]);

/** Which tracker workflow state an event should move the card to (null = leave). */
export function pickTrackerState(
  states: TrackerState[],
  event: MirrorEvent,
): string | null {
  const byType = (type: string, preferName?: RegExp) => {
    const ofType = states.filter((s) => s.type === type);
    const first = ofType[0];
    if (!first) return null;
    if (preferName) {
      const named = ofType.find((s) => preferName.test(s.name));
      if (named) return named.id;
    }
    return first.id;
  };
  switch (event.kind) {
    case "claimed":
      return byType("started", /progress|doing|started/i);
    case "pr_opened": {
      // Only move if the team actually has a review column; "In Progress" is
      // already correct otherwise.
      const review = states.find((s) => s.type === "started" && /review/i.test(s.name));
      return review?.id ?? null;
    }
    case "merged":
      return byType("completed", /done|shipped|merged/i);
    case "pr_closed":
      return byType("backlog");
    case "requeued":
      return byType("unstarted", /todo|ready/i);
    case "blocked":
    case "deployed":
    case "deploy_failed":
      // Evidence-only: the card already sits in Done after the merge.
      return null;
  }
}

/** Which Bob status the work item should take after the event (null = leave). */
export function bobStatusAfter(current: string, event: MirrorEvent): string | null {
  switch (event.kind) {
    case "merged":
      return current === "done" ? null : "done";
    case "pr_closed":
      return IN_FLIGHT.has(current) ? "backlog" : null;
    case "requeued":
      return current === "todo" ? null : "todo";
    case "blocked":
      return current === "blocked" ? null : "blocked";
    default:
      // claimed → in_progress is set atomically by auto-drain's claim UPDATE;
      // pr_opened → in_review is set by the relay. Not our job here.
      return null;
  }
}

export function commentFor(event: MirrorEvent): string {
  switch (event.kind) {
    case "claimed":
      return `🤖 Bob picked this up (agent: ${event.agentType}).`;
    case "pr_opened":
      return `🤖 Bob opened a pull request: ${event.prUrl}\nIt will be reviewed, repaired if needed, and merged automatically when CI is green.`;
    case "merged":
      return `✅ Bob merged the pull request: ${event.prUrl}`;
    case "pr_closed":
      return `↩️ The pull request was closed without merging: ${event.prUrl}\nMoved back to Backlog — promote to Todo to have Bob try again.`;
    case "requeued":
      return `🔁 Bob's run did not finish (${event.reason}). Re-queued for attempt ${event.attempt + 1}.`;
    case "blocked":
      return `⛔ Bob could not complete this: ${event.reason}\nNeeds a human look.`;
    case "deployed":
      return `🚀 Deployed: ${event.summary}`;
    case "deploy_failed":
      return `💥 Deploy FAILED after merge: ${event.summary}\nThe change is on the default branch but is not (fully) live — needs a human look.`;
  }
}

export interface MirrorResult {
  mirrored: boolean;
  bobStatus?: string | null;
  reason?: string;
}

/**
 * Apply the event to the Bob work item (status) and mirror it to the tracker
 * (state + comment). Safe to call for non-imported items — it just updates
 * Bob's status and reports `mirrored: false`.
 */
export async function mirrorWorkItemEvent(
  db: Db,
  workItemId: string,
  event: MirrorEvent,
): Promise<MirrorResult> {
  const item = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: {
      id: true,
      status: true,
      externalProvider: true,
      externalId: true,
      workspaceId: true,
      sourceMetadata: true,
    },
  });
  if (!item) return { mirrored: false, reason: "work item not found" };

  const next = bobStatusAfter(item.status, event);
  if (next) {
    const meta = { ...item.sourceMetadata } as Record<string, unknown>;
    if (event.kind === "requeued") meta.attempts = event.attempt;
    if (event.kind === "blocked") meta.blockedReason = event.reason;
    await db
      .update(workItems)
      .set({ status: next, sourceMetadata: meta })
      .where(eq(workItems.id, item.id));
  }

  if (item.externalProvider !== "linear" || !item.externalId || !item.workspaceId) {
    return { mirrored: false, bobStatus: next, reason: "not an imported tracker item" };
  }

  try {
    const integration = await db.query.workspaceIntegrations.findFirst({
      where: and(
        eq(workspaceIntegrations.workspaceId, item.workspaceId),
        eq(workspaceIntegrations.provider, "linear"),
        eq(workspaceIntegrations.enabled, true),
      ),
    });
    if (!integration?.apiKey) {
      return { mirrored: false, bobStatus: next, reason: "integration disabled" };
    }
    const client = new LinearClient({
      apiKey: integration.apiKey,
      ...(integration.linearApiUrl ? { apiUrl: integration.linearApiUrl } : {}),
    });

    const issue = await client.issue(item.externalId);
    const team = await issue.team;
    let stateId: string | null = null;
    if (team) {
      const states = await team.states();
      stateId = pickTrackerState(
        states.nodes.map((s) => ({ id: s.id, name: s.name, type: s.type })),
        event,
      );
    }
    const current = await issue.state;
    if (stateId && current?.id !== stateId) {
      await client.updateIssue(item.externalId, { stateId });
    }
    await client.createComment({ issueId: item.externalId, body: commentFor(event) });
    return { mirrored: true, bobStatus: next };
  } catch (err) {
    console.error(
      `[tracker-mirror] ${event.kind} for ${item.externalId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return {
      mirrored: false,
      bobStatus: next,
      reason: `tracker error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
