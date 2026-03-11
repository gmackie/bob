import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db, webhooks, webhookDeliveries, issues, issueGitLinks, activities, projects } from "@linear-clone/db";
import { and, eq, ilike, or } from "drizzle-orm";
import { buildIssuePayload, dispatchWebhook } from "@linear-clone/api";

const funnelStageOrder = [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
] as const;

type FunnelStage = (typeof funnelStageOrder)[number];
type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";

function advanceFunnelStage(current: FunnelStage, next?: FunnelStage): FunnelStage {
  if (!next) {
    return current;
  }

  const currentIndex = funnelStageOrder.indexOf(current);
  const nextIndex = funnelStageOrder.indexOf(next);

  if (currentIndex === -1 || nextIndex === -1) {
    return current;
  }

  return nextIndex > currentIndex ? next : current;
}

function computeIssueStateFromPullRequestAction(
  action: string,
  pr: { merged?: boolean; state?: string }
): {
  status?: IssueStatus;
  funnelStage?: FunnelStage;
  statusReason: string;
  linkState: string;
} {
  const normalizedAction = action.toLowerCase();

  if (normalizedAction === "opened" || normalizedAction === "reopened" || normalizedAction === "ready_for_review") {
    return {
      status: "in_review",
      funnelStage: "picked_up",
      statusReason: "pr_opened",
      linkState: pr.state ?? "open",
    };
  }

  if (normalizedAction === "synchronize") {
    return {
      statusReason: "pr_synchronized",
      linkState: pr.state ?? "open",
    };
  }

  if (normalizedAction === "closed" && pr.merged) {
    return {
      status: "done",
      statusReason: "pr_merged",
      linkState: "merged",
    };
  }

  if (normalizedAction === "closed" && !pr.merged) {
    return {
      status: "canceled",
      statusReason: "pr_closed_without_merge",
      linkState: "closed",
    };
  }

  return {
    statusReason: "pr_action_unknown",
    linkState: pr.state ?? "open",
  };
}

function applyReviewStatePatchData(status: IssueStatus) {
  const patch: {
    status?: IssueStatus;
    completedAt?: Date | null;
    canceledAt?: Date | null;
  } = {};

  if (status === "done") {
    patch.completedAt = new Date();
  } else if (status === "canceled") {
    patch.canceledAt = new Date();
  } else if (["backlog", "todo", "in_progress", "in_review"].includes(status)) {
    patch.completedAt = null;
    patch.canceledAt = null;
  }

  return patch;
}

async function dispatchIssueLifecycleWebhooks(
  prior: { status: string; funnelStage: string },
  updatedIssue: typeof issues.$inferSelect
) {
  if (!updatedIssue.projectId) {
    return;
  }

  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, updatedIssue.projectId))
    .limit(1);

  if (!project) {
    return;
  }

  if (prior.status !== updatedIssue.status) {
    await dispatchWebhook(
      db,
      project.workspaceId,
      updatedIssue.projectId,
      "issue.status_changed",
      buildIssuePayload(updatedIssue),
      {
        field: "status",
        from: prior.status,
        to: updatedIssue.status,
      }
    ).catch(() => {});

    if (updatedIssue.status === "done" && prior.status !== "done") {
      await dispatchWebhook(
        db,
        project.workspaceId,
        updatedIssue.projectId,
        "issue.completed",
        buildIssuePayload(updatedIssue),
        {
          field: "status",
          from: prior.status,
          to: updatedIssue.status,
        }
      ).catch(() => {});
    }
  }

  if (prior.funnelStage !== updatedIssue.funnelStage) {
    await dispatchWebhook(
      db,
      project.workspaceId,
      updatedIssue.projectId,
      "issue.funnel_stage_changed",
      buildIssuePayload(updatedIssue),
      {
        field: "funnelStage",
        from: prior.funnelStage,
        to: updatedIssue.funnelStage,
      }
    ).catch(() => {});
  }
}

// Verify GitHub webhook signature
function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// Extract issue identifiers from text (e.g., "ENG-123", "TEAM-45")
function extractIssueIdentifiers(text: string): string[] {
  const pattern = /[A-Z]{2,10}-\d+/g;
  return [...new Set(text.match(pattern) ?? [])];
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  const signature = request.headers.get("x-hub-signature-256");

  // Parse the webhook payload
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Get the repository URL for matching
  const repository = data.repository as { html_url?: string; full_name?: string } | undefined;
  const repoUrl = repository?.html_url ?? "";
  const repoFullName = repository?.full_name ?? "";

  // Find matching webhook configuration
  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.provider, "github"),
        eq(webhooks.enabled, true),
        or(
          ilike(webhooks.repositoryUrl, `%${repoFullName}%`),
          eq(webhooks.repositoryUrl, repoUrl)
        )
      )
    )
    .limit(1);

  // Prepare delivery record
  const deliveryRecord = {
    id: deliveryId ?? crypto.randomUUID(),
    webhookId: webhook?.id ?? null,
    event: event ?? "unknown",
    payload: data,
    success: false,
    statusCode: 200,
    responseBody: null as string | null,
  };

  // If no matching webhook, just log and return
  if (!webhook) {
    deliveryRecord.success = false;
    deliveryRecord.responseBody = "No matching webhook configuration";
    if (deliveryRecord.webhookId) {
      await db.insert(webhookDeliveries).values(deliveryRecord);
    }
    return NextResponse.json({ message: "No matching webhook" }, { status: 200 });
  }

  // Verify signature if secret is set
  if (webhook.secret && !verifyGitHubSignature(payload, signature, webhook.secret)) {
    deliveryRecord.success = false;
    deliveryRecord.responseBody = "Invalid signature";
    await db.insert(webhookDeliveries).values(deliveryRecord);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    // Process different event types
    switch (event) {
      case "pull_request": {
        const action = data.action as string;
        const pr = data.pull_request as {
          title?: string;
          body?: string;
          html_url?: string;
          head?: { ref?: string };
          merged?: boolean;
          number?: number;
          user?: { login?: string };
          state?: string;
        };

        // Extract issue identifiers from PR title, body, and branch name
        const identifiers = [
          ...extractIssueIdentifiers(pr.title ?? ""),
          ...extractIssueIdentifiers(pr.body ?? ""),
          ...extractIssueIdentifiers(pr.head?.ref ?? ""),
        ];
        const lifecycle = computeIssueStateFromPullRequestAction(action, {
          merged: pr.merged,
          state: pr.state,
        });

        for (const identifier of [...new Set(identifiers)]) {
          // Find the issue
          const [issue] = await db
            .select()
            .from(issues)
            .where(eq(issues.identifier, identifier))
            .limit(1);

          if (!issue) continue;

          // Link the PR to the issue
          await db
            .insert(issueGitLinks)
            .values({
              issueId: issue.id,
              provider: "github",
              type: "pull_request",
              url: pr.html_url ?? "",
              title: pr.title ?? "",
              number: pr.number ?? 0,
              state: lifecycle.linkState,
              author: pr.user?.login,
            })
            .onConflictDoUpdate({
              target: [issueGitLinks.issueId, issueGitLinks.url],
              set: {
                state: lifecycle.linkState,
                updatedAt: new Date(),
              },
            });

          const nextPatch: Record<string, unknown> = { updatedAt: new Date() };
          const nextFunnelStage = lifecycle.funnelStage
            ? advanceFunnelStage(issue.funnelStage, lifecycle.funnelStage)
            : issue.funnelStage;

          if (lifecycle.funnelStage && nextFunnelStage !== issue.funnelStage) {
            nextPatch.funnelStage = nextFunnelStage;
            await db.insert(activities).values({
              issueId: issue.id,
              type: "funnel_stage_changed",
              fromValue: issue.funnelStage,
              toValue: nextFunnelStage,
              userId: null,
              changes: {
                field: "funnelStage",
                from: issue.funnelStage,
                to: nextFunnelStage,
                reason: lifecycle.statusReason,
              },
            });
          }

          const shouldUpdateStatus =
            lifecycle.status &&
            issue.status !== lifecycle.status &&
            !(issue.status === "done" && lifecycle.status !== "done");

          if (shouldUpdateStatus) {
            const resolvedStatus = lifecycle.status;
            if (!resolvedStatus) {
              break;
            }
            const statusPatch = applyReviewStatePatchData(resolvedStatus);
            if (issue.status !== resolvedStatus) {
              await db.insert(activities).values({
                issueId: issue.id,
                type: "status_changed",
                fromValue: issue.status,
                toValue: resolvedStatus,
                userId: null,
                changes: {
                  field: "status",
                  from: issue.status,
                  to: resolvedStatus,
                  reason: lifecycle.statusReason,
                },
              });
            }
            Object.assign(nextPatch, statusPatch, { status: resolvedStatus });
          }

          if (Object.keys(nextPatch).length > 1) {
            const [updatedIssue] = await db
              .update(issues)
              .set(nextPatch)
              .where(eq(issues.id, issue.id))
              .returning();

            if (updatedIssue) {
              await dispatchIssueLifecycleWebhooks(
                {
                  status: issue.status,
                  funnelStage: issue.funnelStage,
                },
                updatedIssue
              );
            }
          }
        }
        break;
      }

      case "pull_request_review": {
        const action = data.action as string;
        const review = data.review as {
          state?: string;
          html_url?: string;
          pull_request_url?: string;
          user?: { login?: string };
        };
        const pr = data.pull_request as {
          number?: number;
          title?: string;
          body?: string;
          html_url?: string;
          state?: string;
          head?: { ref?: string };
          merged?: boolean;
        };

        if (action !== "submitted" && action !== "edited" && action !== "dismissed") {
          break;
        }

        const reviewState = (review.state ?? "").toLowerCase();
        const identifiers = [
          ...extractIssueIdentifiers(pr?.title ?? ""),
          ...extractIssueIdentifiers(pr?.body ?? ""),
          ...extractIssueIdentifiers(pr?.head?.ref ?? ""),
        ];

        for (const identifier of [...new Set(identifiers)]) {
          const [issue] = await db.select().from(issues).where(eq(issues.identifier, identifier)).limit(1);
          if (!issue) continue;

          const linkUrl = review.html_url ?? review.pull_request_url ?? pr?.html_url ?? "";
          if (!linkUrl) {
            continue;
          }

          await db
            .insert(issueGitLinks)
            .values({
              issueId: issue.id,
              provider: "github",
              type: "pull_request",
              url: linkUrl,
              number: pr.number ?? 0,
              title: pr.title ?? "PR review",
              state: reviewState || action,
              author: review.user?.login,
            })
            .onConflictDoUpdate({
              target: [issueGitLinks.issueId, issueGitLinks.url],
              set: {
                state: reviewState || action,
                updatedAt: new Date(),
                title: pr.title ?? "PR review",
              },
            });

          const reviewedStatus =
            reviewState === "changes_requested" ? "in_progress" : reviewState === "approved" ? "in_review" : undefined;
          if (!reviewedStatus || reviewedStatus === issue.status || issue.status === "done") {
            continue;
          }

          const patch: Record<string, unknown> = {
            status: reviewedStatus,
            updatedAt: new Date(),
            ...applyReviewStatePatchData(reviewedStatus),
          };

          await db.insert(activities).values({
                issueId: issue.id,
                type: "status_changed",
                fromValue: issue.status,
                toValue: reviewedStatus,
                userId: null,
                changes: {
                  field: "status",
                  from: issue.status,
                  to: reviewedStatus,
                  reason: `PR review ${reviewState || action}`,
                },
            });

          const [updatedIssue] = await db
            .update(issues)
            .set(patch)
            .where(eq(issues.id, issue.id))
            .returning();

          if (updatedIssue) {
            await dispatchIssueLifecycleWebhooks(
              {
                status: issue.status,
                funnelStage: issue.funnelStage,
              },
              updatedIssue
            );
          }
        }
        break;
      }

      case "push": {
        // Handle push events - link commits to issues
        const commits = (data.commits ?? []) as Array<{
          message?: string;
          url?: string;
          id?: string;
          author?: { username?: string };
        }>;

        for (const commit of commits) {
          const identifiers = extractIssueIdentifiers(commit.message ?? "");

          for (const identifier of identifiers) {
            const [issue] = await db
              .select()
              .from(issues)
              .where(eq(issues.identifier, identifier))
              .limit(1);

            if (!issue) continue;

            await db
              .insert(issueGitLinks)
              .values({
                issueId: issue.id,
                provider: "github",
                type: "commit",
                url: commit.url ?? "",
                externalId: commit.id,
                title: (commit.message ?? "").split("\n")[0] ?? "",
                state: "committed",
                author: commit.author?.username,
              })
              .onConflictDoNothing();
          }
        }
        break;
      }

      case "issues": {
        const action = data.action as string;
        const issue = data.issue as {
          number?: number;
          state?: string;
        };

        if ((action === "opened" || action === "closed" || action === "reopened") && issue.number) {
          const externalState = action === "closed" ? "closed" : "open";
          const newStatus = externalState === "closed" ? "done" : "todo";

          const [linkedIssue] = await db
            .select({ issue: issues, project: projects })
            .from(issues)
            .innerJoin(projects, eq(issues.projectId, projects.id))
            .where(
              and(
                eq(issues.externalIssueProvider, "github"),
                eq(issues.externalIssueNumber, issue.number),
                eq(projects.repositoryFullName, repoFullName),
                eq(projects.issueSyncEnabled, true)
              )
            )
            .limit(1);

              if (linkedIssue && linkedIssue.issue.status !== newStatus) {
                const syncDirection = linkedIssue.project.issueSyncDirection ?? "bidirectional";
                if (syncDirection !== "outbound_only") {
                  const priorStatus = linkedIssue.issue.status;
                  const updateData: Record<string, unknown> = {
                    status: newStatus,
                    updatedAt: new Date(),
                    externalIssueSyncedAt: new Date(),
                  };

              if (newStatus === "done" && linkedIssue.issue.status !== "done") {
                updateData.completedAt = new Date();
              }
                  
              const [updatedIssue] = await db
                .update(issues)
                .set(updateData)
                .where(eq(issues.id, linkedIssue.issue.id))
                .returning();

              await db.insert(activities).values({
                issueId: linkedIssue.issue.id,
                type: "status_changed",
                fromValue: linkedIssue.issue.status,
                toValue: newStatus,
                changes: {
                  field: "status",
                  from: linkedIssue.issue.status,
                  to: newStatus,
                  reason: `GitHub issue #${issue.number} ${action}`,
                },
              });

              if (updatedIssue) {
                await dispatchIssueLifecycleWebhooks(
                  {
                    status: priorStatus,
                    funnelStage: linkedIssue.issue.funnelStage,
                  },
                  updatedIssue
                );
              }
            }
          }
        }
        break;
      }

      case "issue_comment":
      case "pull_request_review_comment": {
        break;
      }
    }

    deliveryRecord.success = true;
    deliveryRecord.responseBody = "Processed successfully";
    await db.insert(webhookDeliveries).values(deliveryRecord);

    return NextResponse.json({ message: "Webhook processed" }, { status: 200 });
  } catch (error) {
    deliveryRecord.success = false;
    deliveryRecord.responseBody = error instanceof Error ? error.message : "Unknown error";
    await db.insert(webhookDeliveries).values(deliveryRecord);

    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}

// Also handle GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
