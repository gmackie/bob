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
 *
 * Kanbanger integrations (a `linearApiUrl` pointing at a Linear-compatible
 * clone) no longer have their review/done states set by Bob. "Ready for
 * review" is a delivery report (kanbangerDelivery.ts): Kanbanger moves the
 * issue to review only if its progress gates allow it, and notifies the human
 * reviewer. A merge is reported as a delivery fact and Done is left to
 * Kanbanger's gates. The GraphQL state move is kept only (a) for real Linear,
 * (b) for In Progress on claim, and (c) as the fallback while the delivery
 * endpoint is unavailable (404 / network) — and never for Done on Kanbanger.
 */
import { LinearClient } from "@linear/sdk";

import { and, desc, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  activities,
  chatConversations,
  chatMessages,
  workItems,
  workspaceIntegrations,
} from "@bob/db/schema";

import {
  buildPrFact,
  buildReviewRequest,
  kanbangerOrigin,
  postDeliveryReport,
} from "./kanbangerDelivery.js";
import type { DeliveryResult } from "./kanbangerDelivery.js";

/** What Bob knows about the change when it says "ready for review". */
export interface ReviewContext {
  summary: string;
  testPlan: string[];
  commitUrl?: string | null;
  previewUrl?: string | null;
}

export type MirrorEvent =
  | { kind: "claimed"; agentType: string }
  | { kind: "pr_opened"; prUrl: string; review?: ReviewContext }
  /** Re-report after the reviewer's "Request changes" was addressed on the PR. */
  | { kind: "review_ready"; prUrl: string; review: ReviewContext }
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
    case "pr_opened":
    case "review_ready": {
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
    case "review_ready":
      // The requested changes were pushed to the PR: back in front of the
      // reviewer. (A gate-blocked report moves it back to in_progress below.)
      return current === "in_review" || current === "done" ? null : "in_review";
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
    case "review_ready":
      return `🤖 Bob addressed the requested changes and updated the pull request: ${event.prUrl}`;
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

    // Kanbanger: review and done are reported, not set. `moveState` stays true
    // only for events Kanbanger has no delivery report for (claim → In
    // Progress, close → Backlog, requeue → Todo) and for the 404/network
    // fallback of a ready report.
    let moveState = true;
    let bobStatus = next;
    let delivery: DeliveryResult | null = null;
    if (kanbangerOrigin(integration.linearApiUrl)) {
      const outcome = await reportToKanbanger(db, client, item, event, {
        apiUrl: integration.linearApiUrl,
        apiKey: integration.apiKey,
      });
      moveState = outcome.moveState;
      delivery = outcome.delivery;
      if (outcome.bobStatus !== undefined) bobStatus = outcome.bobStatus;
    }

    const issue = await client.issue(item.externalId);
    if (moveState) {
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
    }
    await client.createComment({ issueId: item.externalId, body: commentFor(event) });
    return {
      mirrored: true,
      bobStatus,
      ...(delivery && !delivery.ok ? { reason: `delivery ${delivery.kind}: ${delivery.detail}` } : {}),
    };
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

// ---------------------------------------------------------------------------
// Kanbanger delivery reports
// ---------------------------------------------------------------------------

interface MirrorItem {
  id: string;
  status: string;
  externalId: string | null;
  sourceMetadata: unknown;
}

interface KanbangerOutcome {
  /** Whether the GraphQL state move should still run. */
  moveState: boolean;
  /** Override of the Bob status reported back (undefined = unchanged). */
  bobStatus?: string | null;
  delivery: DeliveryResult | null;
}

/**
 * Kanbanger's workspace UUID — what the delivery path is keyed on. Kanbanger's
 * Linear-compatible GraphQL exposes the active workspace as `organization`.
 */
async function kanbangerWorkspaceId(client: LinearClient): Promise<string | null> {
  try {
    const org = await client.organization;
    return org.id;
  } catch (err) {
    console.warn(
      "[tracker-mirror] could not resolve the Kanbanger workspace id:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function reportToKanbanger(
  db: Db,
  client: LinearClient,
  item: MirrorItem,
  event: MirrorEvent,
  config: { apiUrl: string | null; apiKey: string },
): Promise<KanbangerOutcome> {
  const externalId = item.externalId;
  if (!externalId) return { moveState: true, delivery: null };

  if (event.kind === "merged") {
    // Done comes from Kanbanger's gates and the merge evidence, never from Bob
    // forcing a `completed` state — so no state move even if the fact fails.
    const workspaceId = await kanbangerWorkspaceId(client);
    const delivery = workspaceId
      ? await postDeliveryReport(config, workspaceId, buildPrFact(externalId, event.prUrl, "merged"))
      : null;
    if (delivery && !delivery.ok) {
      console.warn(`[tracker-mirror] PR merged fact for ${externalId} not recorded: ${delivery.kind} ${delivery.detail}`);
    }
    return { moveState: false, delivery };
  }

  if (event.kind !== "pr_opened" && event.kind !== "review_ready") {
    return { moveState: true, delivery: null };
  }

  const workspaceId = await kanbangerWorkspaceId(client);
  if (!workspaceId) return { moveState: true, delivery: null };

  if (event.kind === "pr_opened") {
    const fact = await postDeliveryReport(config, workspaceId, buildPrFact(externalId, event.prUrl, "opened"));
    if (!fact.ok) {
      console.warn(`[tracker-mirror] PR opened fact for ${externalId} not recorded: ${fact.kind} ${fact.detail}`);
    }
  }

  // No review context means the caller only knew a PR exists (not that Bob's
  // run finished): keep the previous behaviour rather than claim readiness.
  const review = event.review;
  if (!review) return { moveState: true, delivery: null };

  const meta = { ...(item.sourceMetadata as Record<string, unknown> | null) };
  const prior = typeof meta.reviewRevision === "number" ? meta.reviewRevision : 0;
  const revision = prior + 1;
  const delivery = await postDeliveryReport(
    config,
    workspaceId,
    buildReviewRequest({
      externalIssueId: externalId,
      workItemId: item.id,
      revision,
      summary: review.summary,
      testPlan: review.testPlan,
      prUrl: event.prUrl,
      commitUrl: review.commitUrl,
      previewUrl: review.previewUrl,
    }),
  );

  if (delivery.ok) {
    await patchMeta(db, item.id, {
      reviewRevision: revision,
      lastReviewRequestAt: new Date().toISOString(),
      deliveryBlocked: null,
    });
    return { moveState: false, delivery };
  }

  if (delivery.kind === "gate_blocked") {
    // Unmet progress gates: Bob must not claim the item is ready. Keep it in
    // progress and leave the blocker where a human (and the next run) sees it.
    const blocker = {
      reason: delivery.reason,
      detail: delivery.detail,
      prUrl: event.prUrl,
      at: new Date().toISOString(),
    };
    await recordDeliveryBlocked(db, item, blocker);
    console.warn(
      `[tracker-mirror] ${externalId} not ready for review — Kanbanger progress gates blocked it (${delivery.reason}); kept in progress`,
    );
    return { moveState: false, bobStatus: "in_progress", delivery };
  }

  console.warn(
    `[tracker-mirror] delivery report for ${externalId} unavailable (${delivery.kind} ${delivery.status ?? "network"}: ${delivery.detail}); falling back to the GraphQL review state`,
  );
  return { moveState: true, delivery };
}

async function patchMeta(db: Db, workItemId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { sourceMetadata: true },
  });
  const meta = { ...row?.sourceMetadata } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete meta[k];
    else meta[k] = v;
  }
  await db.update(workItems).set({ sourceMetadata: meta }).where(eq(workItems.id, workItemId));
}

async function recordDeliveryBlocked(
  db: Db,
  item: MirrorItem,
  blocker: { reason: string; detail: string; prUrl: string; at: string },
): Promise<void> {
  const row = await db.query.workItems.findFirst({
    where: eq(workItems.id, item.id),
    columns: { status: true, sourceMetadata: true },
  });
  const meta = { ...row?.sourceMetadata, deliveryBlocked: blocker } as Record<string, unknown>;
  const status = row?.status === "in_review" ? "in_progress" : row?.status;
  await db
    .update(workItems)
    .set({ sourceMetadata: meta, ...(status ? { status } : {}) })
    .where(eq(workItems.id, item.id));

  const message =
    `Kanbanger did not accept "ready for review": the issue has unmet progress gates (${blocker.reason}). ` +
    `The work item stays in progress until they are addressed. PR: ${blocker.prUrl}`;
  try {
    await db.insert(activities).values({
      workItemId: item.id,
      type: "status_changed",
      fromValue: row?.status ?? null,
      toValue: status ?? null,
      metadata: { source: "kanbanger_delivery", deliveryBlocked: blocker, message },
    });
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.workItemId, item.id),
      columns: { id: true },
      orderBy: [desc(chatConversations.createdAt)],
    });
    if (session) {
      await db.insert(chatMessages).values({ conversationId: session.id, role: "system", content: message });
    }
  } catch (err) {
    console.warn("[tracker-mirror] could not record the delivery blocker:", err instanceof Error ? err.message : err);
  }
}
