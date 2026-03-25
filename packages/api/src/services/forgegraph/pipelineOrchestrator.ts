import { and, desc, eq } from "@bob/db";
import {
  dispatchItems,
  forgeRevisions,
  forgeBuilds,
  forgeDeployments,
  notifications,
  taskRuns,
  workItemArtifacts,
} from "@bob/db/schema";
import { emitWebhookEvent } from "../webhooks/webhookDeliveryService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;

/**
 * Pipeline state machine for a dispatch item.
 * Called by checkProgress on each polling cycle.
 *
 * States:
 *   null → agent_complete → awaiting_review → building → gates_passed →
 *   deploying_dev → dev_healthy → deploying_staging → staging_healthy →
 *   awaiting_prod_approval → deploying_prod → prod_healthy → complete
 *
 *   Any state → build_failed / deploy_failed / review_failed (terminal failure states)
 */

const TERMINAL_STATES = ["complete", "build_failed", "deploy_failed", "review_failed"];

interface PipelineItem {
  id: string;
  pipelineState: string | null;
  taskRunId: string | null;
  planningTaskId: string;
  planningTaskIdentifier: string;
  title: string;
  agentType: string;
}

interface PipelineBatch {
  id: string;
  userId: string;
}

/** Map pipeline state to the webhook event name emitted on entry. */
const STATE_WEBHOOK_EVENTS: Record<string, string> = {
  building: "pipeline.build_started",
  gates_passed: "pipeline.build_passed",
  build_failed: "pipeline.build_failed",
  deploying_dev: "pipeline.deploy_started",
  dev_healthy: "pipeline.deploy_healthy",
  deploying_staging: "pipeline.deploy_started",
  staging_healthy: "pipeline.deploy_healthy",
  awaiting_prod_approval: "pipeline.awaiting_approval",
  deploying_prod: "pipeline.deploy_started",
  prod_healthy: "pipeline.deploy_healthy",
  deploy_failed: "pipeline.deploy_failed",
  complete: "pipeline.complete",
};

export async function advancePipeline(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  const stateBefore = item.pipelineState;

  // Terminal states — nothing to do
  if (stateBefore && TERMINAL_STATES.includes(stateBefore)) return;

  switch (stateBefore) {
    case "agent_complete":
      await handleAgentComplete(db, item);
      break;
    case "awaiting_review":
      await handleAwaitingReview(db, item, batch);
      break;
    case "building":
      await handleBuilding(db, item, batch);
      break;
    case "gates_passed":
      await handleGatesPassed(db, item);
      break;
    case "deploying_dev":
      await handleDeploying(db, item, batch, "dev", "dev_healthy");
      break;
    case "dev_healthy":
      await handleDevHealthy(db, item);
      break;
    case "deploying_staging":
      await handleDeploying(db, item, batch, "staging", "staging_healthy");
      break;
    case "staging_healthy":
      await handleStagingHealthy(db, item, batch);
      break;
    case "awaiting_prod_approval":
      // No-op — waits for user action via approveProdDeploy
      break;
    case "deploying_prod":
      await handleDeploying(db, item, batch, "prod", "prod_healthy");
      break;
    case "prod_healthy":
      await handleProdHealthy(db, item, batch);
      break;
    default:
      // Unknown or null state — do nothing
      break;
  }

  // Emit webhook if the pipeline state changed
  const updated = await db.query.dispatchItems.findFirst({
    where: eq(dispatchItems.id, item.id),
    columns: { pipelineState: true },
  });
  const stateAfter = updated?.pipelineState ?? null;

  if (stateAfter && stateAfter !== stateBefore) {
    const webhookEvent = STATE_WEBHOOK_EVENTS[stateAfter];
    if (webhookEvent) {
      // Fire-and-forget — delivery failures must not block the pipeline
      emitWebhookEvent(webhookEvent, batch.userId, {
        dispatchItemId: item.id,
        taskIdentifier: item.planningTaskIdentifier,
        title: item.title,
        previousState: stateBefore,
        state: stateAfter,
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// State handlers
// ---------------------------------------------------------------------------

async function handleAgentComplete(
  db: Database,
  item: PipelineItem,
): Promise<void> {
  if (!item.taskRunId) return;

  // Transition to awaiting_review — the review gate will approve before building
  await setPipelineState(db, item.id, "awaiting_review");
}

async function handleAwaitingReview(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  // Check for a current code_review artifact for this task's work item
  const review = await db.query.workItemArtifacts.findFirst({
    where: and(
      eq(workItemArtifacts.artifactType, "code_review"),
      eq(workItemArtifacts.isCurrent, true),
      eq(workItemArtifacts.workItemId, item.planningTaskId),
    ),
  });

  if (!review?.content) return; // No review yet — wait

  try {
    const parsed = JSON.parse(review.content as string) as { decision: string };

    if (parsed.decision === "approve") {
      // Review passed — trigger build
      await triggerBuild(db, item);
      await setPipelineState(db, item.id, "building");
    } else if (parsed.decision === "request_changes") {
      // Resume execution agent with review feedback, then mark this
      // review artifact as stale so the next review cycle creates a new one.
      console.log(
        `[pipeline] Review requested changes for ${item.planningTaskIdentifier}`,
      );

      const reviewContent = parsed as {
        decision: string;
        summary?: string;
        comments?: Array<{ file: string; line: number; comment: string }>;
      };

      const feedbackLines = [
        "Code review requested changes:",
        reviewContent.summary ?? "",
        "",
      ];

      if (reviewContent.comments && reviewContent.comments.length > 0) {
        feedbackLines.push("Specific comments:");
        for (const c of reviewContent.comments) {
          feedbackLines.push(`- ${c.file}:${c.line} — ${c.comment}`);
        }
      }

      const feedbackMessage = feedbackLines.join("\n");

      // Find the execution task run (not the review task run) for this item
      if (item.taskRunId) {
        const { resumeBlockedTask } = await import(
          "@bob/execution/runtime/taskExecutor"
        );
        void resumeBlockedTask(item.taskRunId, feedbackMessage).catch((err) =>
          console.error(
            `[pipeline] Failed to resume task with review feedback:`,
            err,
          ),
        );
      }

      // Mark the review artifact as stale so the next review creates a fresh one
      await db
        .update(workItemArtifacts)
        .set({ isCurrent: false })
        .where(eq(workItemArtifacts.id, review.id));
    }
  } catch {
    // Malformed review artifact
    console.error(
      `[pipeline] Failed to parse review artifact for ${item.planningTaskIdentifier}`,
    );
  }
}

/**
 * Trigger a build for a dispatch item. Extracted from handleAgentComplete
 * so it can be reused by handleAwaitingReview after review approval.
 */
async function triggerBuild(
  db: Database,
  item: PipelineItem,
): Promise<void> {
  if (!item.taskRunId) return;

  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.taskRunId, item.taskRunId),
  });
  if (!revision) return;

  await db
    .insert(forgeBuilds)
    .values({
      revisionId: revision.id,
      repoId: revision.repoId,
      idempotencyKey: item.id,
    })
    .onConflictDoNothing({
      target: [forgeBuilds.idempotencyKey],
    });
}

async function handleBuilding(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  // Find the build created for this item (keyed by item.id)
  const build = await db.query.forgeBuilds.findFirst({
    where: eq(forgeBuilds.idempotencyKey, item.id),
  });
  if (!build) return;

  if (build.status === "passed") {
    await setPipelineState(db, item.id, "gates_passed");
  } else if (build.status === "failed" || build.status === "canceled") {
    await setPipelineState(db, item.id, "build_failed");
    await db.insert(notifications).values({
      userId: batch.userId,
      title: `Build failed for ${item.planningTaskIdentifier}`,
      body: `Build ${build.status} for "${item.title}"`,
      type: "task_completed",
      url: `/work-items/${item.planningTaskId}`,
    });
  }
  // Otherwise (queued/running) — no-op, wait
}

async function handleGatesPassed(
  db: Database,
  item: PipelineItem,
): Promise<void> {
  const { revisionId, buildId } = await getRevisionAndBuild(db, item);
  if (!revisionId || !buildId) return;

  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.id, revisionId),
  });
  if (!revision) return;

  // Create dev deployment
  await db.insert(forgeDeployments).values({
    revisionId,
    buildId,
    repoId: revision.repoId,
    environment: "dev",
    status: "deploying",
  });

  await setPipelineState(db, item.id, "deploying_dev");
}

async function handleDeploying(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
  environment: string,
  nextState: string,
): Promise<void> {
  const { revisionId } = await getRevisionAndBuild(db, item);
  if (!revisionId) return;

  // Query latest deployment for this revision + environment
  const deployment = await db.query.forgeDeployments.findFirst({
    where: and(
      eq(forgeDeployments.revisionId, revisionId),
      eq(forgeDeployments.environment, environment),
    ),
    orderBy: [desc(forgeDeployments.createdAt)],
  });
  if (!deployment) return;

  if (deployment.status === "healthy") {
    await setPipelineState(db, item.id, nextState);
  } else if (
    deployment.status === "failed" ||
    deployment.status === "unhealthy"
  ) {
    await setPipelineState(db, item.id, "deploy_failed");
    await db.insert(notifications).values({
      userId: batch.userId,
      title: `Deploy failed for ${item.planningTaskIdentifier}`,
      body: `${environment} deployment ${deployment.status} for "${item.title}"`,
      type: "task_completed",
      url: `/work-items/${item.planningTaskId}`,
    });
  }
  // Otherwise (deploying/pending_approval) — no-op, wait
}

async function handleDevHealthy(
  db: Database,
  item: PipelineItem,
): Promise<void> {
  const { revisionId, buildId } = await getRevisionAndBuild(db, item);
  if (!revisionId || !buildId) return;

  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.id, revisionId),
  });
  if (!revision) return;

  // Create staging deployment
  await db.insert(forgeDeployments).values({
    revisionId,
    buildId,
    repoId: revision.repoId,
    environment: "staging",
    status: "deploying",
  });

  await setPipelineState(db, item.id, "deploying_staging");
}

async function handleStagingHealthy(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  await db.insert(notifications).values({
    userId: batch.userId,
    title: `Staging healthy for ${item.planningTaskIdentifier}`,
    body: `Staging healthy for "${item.title}" — approve production deploy`,
    type: "task_completed",
    url: `/work-items/${item.planningTaskId}`,
  });

  await setPipelineState(db, item.id, "awaiting_prod_approval");
}

async function handleProdHealthy(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  await setPipelineState(db, item.id, "complete");

  await db.insert(notifications).values({
    userId: batch.userId,
    title: `Production deploy complete for ${item.planningTaskIdentifier}`,
    body: `"${item.title}" is live in production`,
    type: "task_completed",
    url: `/work-items/${item.planningTaskId}`,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setPipelineState(
  db: Database,
  itemId: string,
  state: string,
): Promise<void> {
  await db
    .update(dispatchItems)
    .set({ pipelineState: state })
    .where(eq(dispatchItems.id, itemId));
}

/**
 * Look up the revision and build IDs for a dispatch item's pipeline.
 * The build is keyed by item.id as the idempotencyKey.
 */
async function getRevisionAndBuild(
  db: Database,
  item: PipelineItem,
): Promise<{ revisionId: string | null; buildId: string | null }> {
  const build = await db.query.forgeBuilds.findFirst({
    where: eq(forgeBuilds.idempotencyKey, item.id),
  });
  if (!build) return { revisionId: null, buildId: null };
  return { revisionId: build.revisionId, buildId: build.id };
}
