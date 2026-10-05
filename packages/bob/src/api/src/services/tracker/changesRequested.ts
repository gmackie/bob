/**
 * Kanbanger "Request changes" → Bob resumes the work with the reviewer's note.
 *
 * When a human reviews Bob's "ready for review" report and requests changes,
 * Kanbanger moves the issue back to In Progress, assigns it back to the agent
 * and adds a comment starting `Changes requested:` with the reviewer's note.
 * Bob learns about it from two places, both funnelled through
 * {@link applyChangesRequested} so a request is acted on exactly once (keyed on
 * the comment id):
 *  - the Linear-shaped `Comment` webhook Kanbanger emits (processLinearWebhook),
 *  - the periodic tracker sync, as the backstop for a missed webhook
 *    (linearSetup.syncLinearProjects → {@link findChangesRequestComment}).
 *
 * How the work resumes depends on whether the change can land on the PR the
 * reviewer saw:
 *  - an open PR exists → the item goes to `in_progress` with a pending request
 *    on its metadata; autoMergeReview refuses to merge that PR, dispatches a
 *    repair session on its branch with the note as the requested changes, and
 *    re-reports "ready for review" (a new revision) once the fix is pushed;
 *  - no open PR (merged, closed, or none) → the item goes back to `todo` and
 *    autoDrain re-dispatches it with the note appended to the task description.
 */
import { and, desc, eq, inArray } from "@bob/db";
import type { Db } from "@bob/db/client";
import { activities, chatConversations, pullRequests, workItems } from "@bob/db/schema";

import { parseChangesRequested } from "./kanbangerDelivery.js";

export interface ChangesRequestedMeta {
  pending: boolean;
  note: string;
  commentId: string;
  at: string;
  /** The open PR the fix must land on; null → re-run from scratch via autoDrain. */
  prUrl: string | null;
  /** Head SHA the repair session was dispatched against (set by autoMergeReview). */
  repairHeadSha?: string | null;
  /** When autoDrain re-dispatched the item with the note (no-PR route). */
  dispatchedAt?: string | null;
}

const MAX_HANDLED = 20;

export function readChangesRequested(meta: unknown): ChangesRequestedMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const cr = (meta as Record<string, unknown>).changesRequested;
  if (!cr || typeof cr !== "object") return null;
  const v = cr as Partial<ChangesRequestedMeta>;
  if (!v.pending || typeof v.commentId !== "string") return null;
  return {
    pending: true,
    note: typeof v.note === "string" ? v.note : "",
    commentId: v.commentId,
    at: typeof v.at === "string" ? v.at : "",
    prUrl: typeof v.prUrl === "string" ? v.prUrl : null,
    repairHeadSha: v.repairHeadSha ?? null,
    dispatchedAt: v.dispatchedAt ?? null,
  };
}

/** The reviewer's note phrased for an agent prompt. */
export function changesRequestedPrompt(note: string): string {
  return [
    "## Changes requested by the reviewer",
    "A human reviewed your previous delivery in Kanbanger and requested changes. Address them:",
    "",
    note || "(The reviewer left no note — re-check the issue's acceptance criteria and test plan.)",
  ].join("\n");
}

export interface ApplyChangesRequestedInput {
  /** Kanbanger issue UUID and/or identifier — matched against work_items.external_id. */
  issueKeys: string[];
  commentId: string;
  /** The full comment body; must start with `Changes requested:`. */
  body: string;
  source: "webhook" | "sync";
}

export type ApplyChangesRequestedResult =
  | { applied: true; workItemId: string; route: "repair" | "requeue" }
  | { applied: false; reason: string };

export async function applyChangesRequested(
  db: Db,
  input: ApplyChangesRequestedInput,
): Promise<ApplyChangesRequestedResult> {
  const note = parseChangesRequested(input.body);
  if (note === null) return { applied: false, reason: "not a change request" };
  const keys = input.issueKeys.filter((k) => typeof k === "string" && k.length > 0);
  if (!keys.length) return { applied: false, reason: "no issue key" };

  const item = await db.query.workItems.findFirst({
    where: and(inArray(workItems.externalId, keys), eq(workItems.externalProvider, "linear")),
    columns: { id: true, status: true, sourceMetadata: true },
  });
  if (!item) return { applied: false, reason: "no imported work item" };
  if (item.status === "cancelled") return { applied: false, reason: "work item cancelled" };

  const meta = { ...item.sourceMetadata } as Record<string, unknown>;
  const handled = Array.isArray(meta.handledChangeRequests)
    ? (meta.handledChangeRequests as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  if (handled.includes(input.commentId)) return { applied: false, reason: "already handled" };

  const openPr = await latestOpenPrUrl(db, item.id);
  const route = openPr ? "repair" : "requeue";
  const status = openPr ? "in_progress" : "todo";
  const changesRequested: ChangesRequestedMeta = {
    pending: true,
    note,
    commentId: input.commentId,
    at: new Date().toISOString(),
    prUrl: openPr,
    repairHeadSha: null,
    dispatchedAt: null,
  };
  const { deliveryBlocked: _cleared, ...rest } = meta;
  await db
    .update(workItems)
    .set({
      status,
      sourceMetadata: {
        ...rest,
        changesRequested,
        handledChangeRequests: [...handled, input.commentId].slice(-MAX_HANDLED),
      },
    })
    .where(eq(workItems.id, item.id));

  try {
    await db.insert(activities).values({
      workItemId: item.id,
      type: "review_changes_requested",
      fromValue: item.status,
      toValue: status,
      metadata: { source: `kanbanger_${input.source}`, commentId: input.commentId, note, route, prUrl: openPr },
    });
  } catch (err) {
    console.warn("[changes-requested] activity insert failed:", err instanceof Error ? err.message : err);
  }

  console.log(
    `[changes-requested] ${item.id.slice(0, 8)} ${item.status} → ${status} via ${route} (${input.source}, comment ${input.commentId})`,
  );
  return { applied: true, workItemId: item.id, route };
}

/** The URL of the newest still-open PR any of the work item's sessions produced. */
async function latestOpenPrUrl(db: Db, workItemId: string): Promise<string | null> {
  const sessions = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.workItemId, workItemId));
  if (!sessions.length) return null;
  const pr = await db.query.pullRequests.findFirst({
    where: and(
      inArray(
        pullRequests.sessionId,
        sessions.map((s) => s.id),
      ),
      eq(pullRequests.status, "open"),
    ),
    columns: { url: true },
    orderBy: [desc(pullRequests.createdAt)],
  });
  return pr?.url ?? null;
}

/**
 * Sync backstop: the newest `Changes requested:` comment on an issue, if it is
 * newer than Bob's last ready report (older ones were answered by that report).
 */
export function findChangesRequestComment(
  comments: { id: string; body: string; createdAt: Date | string }[],
  since: string | null | undefined,
): { id: string; body: string } | null {
  const floor = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const matches = comments
    .filter((c) => parseChangesRequested(c.body) !== null)
    .map((c) => ({ ...c, t: new Date(c.createdAt).getTime() }))
    .filter((c) => Number.isFinite(c.t) && c.t > floor)
    .sort((a, b) => b.t - a.t);
  const latest = matches[0];
  return latest ? { id: latest.id, body: latest.body } : null;
}
