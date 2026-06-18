import { eq } from "@bob/db";
import {
  forgeRevisions,
  forgeRunEvents,
  taskRuns,
} from "@bob/db/schema";

// Use the same db type as ctx.db in tRPC procedures (or the default export from @bob/db/client)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;

export class ForgeGraphEventReporter {
  constructor(private db: Database) {}

  /** Called after executeTask creates a session + taskRun */
  async reportCreated(taskRun: {
    id: string;
    repositoryId: string | null;
    branch: string | null;
    planningItemId: string;
    workItemId?: string | null;
  }): Promise<void> {
    if (!taskRun.repositoryId) return;

    // Create or update a forge revision for this task run
    const revId = taskRun.branch ?? taskRun.id; // Use branch as revId, fallback to taskRunId

    const [revision] = await this.db
      .insert(forgeRevisions)
      .values({
        repoId: taskRun.repositoryId,
        revId,
        taskId: taskRun.workItemId ?? null,
        taskRunId: taskRun.id,
        branch: taskRun.branch,
      })
      .onConflictDoUpdate({
        target: [forgeRevisions.repoId, forgeRevisions.revId],
        set: { taskRunId: taskRun.id, branch: taskRun.branch },
      })
      .returning();

    if (!revision) return;

    // Record the "created" event
    await this.db.insert(forgeRunEvents).values({
      runId: taskRun.id,
      repoId: taskRun.repositoryId,
      revisionId: revision.id,
      eventType: "created",
      taskId: taskRun.workItemId ?? null,
    });

    console.log(`[forgegraph] Reported 'created' for task run ${taskRun.id}`);
  }

  /** Called when task completes (approved for review) */
  async reportApproved(taskRunId: string): Promise<void> {
    await this.ingestEvent(taskRunId, "approved");
  }

  /** Called when task fails */
  async reportFailed(taskRunId: string): Promise<void> {
    await this.ingestEvent(taskRunId, "failed");
  }

  /** Called when code is integrated (PR merged) */
  async reportIntegrated(taskRunId: string): Promise<void> {
    await this.ingestEvent(taskRunId, "integrated");
  }

  /** Called when agent commits code */
  async reportPatchApplied(
    taskRunId: string,
    commitSha: string,
  ): Promise<void> {
    // Update the revision's revId to the actual commit SHA
    const run = await this.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, taskRunId),
    });
    if (!run?.repositoryId) return;

    const revision = await this.db.query.forgeRevisions.findFirst({
      where: eq(forgeRevisions.taskRunId, taskRunId),
    });
    if (!revision) return;

    // Update revId to commit SHA
    await this.db
      .update(forgeRevisions)
      .set({ revId: commitSha })
      .where(eq(forgeRevisions.id, revision.id));

    await this.db.insert(forgeRunEvents).values({
      runId: taskRunId,
      repoId: run.repositoryId,
      revisionId: revision.id,
      eventType: "patch_applied",
    });

    console.log(
      `[forgegraph] Reported 'patch_applied' for task run ${taskRunId}`,
    );
  }

  async reportTestsStarted(taskRunId: string): Promise<void> {
    await this.ingestEvent(taskRunId, "tests_started");
  }

  async reportTestsFinished(
    taskRunId: string,
    passed: boolean,
  ): Promise<void> {
    await this.ingestEvent(
      taskRunId,
      "tests_finished",
      passed ? "passed" : "failed",
    );
  }

  /** Internal helper: look up taskRun + revision, insert event */
  private async ingestEvent(
    taskRunId: string,
    eventType: string,
    testStatus?: string,
  ): Promise<void> {
    try {
      const run = await this.db.query.taskRuns.findFirst({
        where: eq(taskRuns.id, taskRunId),
      });
      if (!run?.repositoryId) return;

      const revision = await this.db.query.forgeRevisions.findFirst({
        where: eq(forgeRevisions.taskRunId, taskRunId),
      });
      if (!revision) return;

      await this.db.insert(forgeRunEvents).values({
        runId: taskRunId,
        repoId: run.repositoryId,
        revisionId: revision.id,
        eventType,
        taskId: run.workItemId ?? null,
        testStatus: testStatus ?? null,
      });

      console.log(
        `[forgegraph] Reported '${eventType}' for task run ${taskRunId}`,
      );
    } catch (err) {
      console.error(
        `[forgegraph] Failed to report '${eventType}' for ${taskRunId}:`,
        err,
      );
    }
  }
}
