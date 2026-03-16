import { and, desc, eq } from "@bob/db";
import {
  dispatchItems,
  forgeRevisions,
  forgeBuilds,
  forgeDeployments,
  notifications,
} from "@bob/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;

/**
 * Pipeline state machine for a dispatch item.
 * Called by checkProgress on each polling cycle.
 *
 * States:
 *   null → agent_complete → building → gates_passed → deploying_dev → dev_healthy →
 *   deploying_staging → staging_healthy → awaiting_prod_approval →
 *   deploying_prod → prod_healthy → complete
 *
 *   Any state → build_failed / deploy_failed (terminal failure states)
 */

const TERMINAL_STATES = ["complete", "build_failed", "deploy_failed"];

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

export async function advancePipeline(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  const state = item.pipelineState;

  // Terminal states — nothing to do
  if (state && TERMINAL_STATES.includes(state)) return;

  switch (state) {
    case "agent_complete":
      await handleAgentComplete(db, item);
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
}

// ---------------------------------------------------------------------------
// State handlers
// ---------------------------------------------------------------------------

async function handleAgentComplete(
  db: Database,
  item: PipelineItem,
): Promise<void> {
  if (!item.taskRunId) return;

  // Look up the forge revision for this task run
  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.taskRunId, item.taskRunId),
  });
  if (!revision) return;

  // Trigger a build — idempotent via idempotencyKey
  await db
    .insert(forgeBuilds)
    .values({
      revisionId: revision.id,
      repoId: revision.repoId,
      idempotencyKey: item.id, // one build per dispatch item
    })
    .onConflictDoNothing({
      target: [forgeBuilds.idempotencyKey],
    });

  await setPipelineState(db, item.id, "building");
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
