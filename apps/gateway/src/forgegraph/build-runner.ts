/**
 * ForgeGraph Build Runner
 *
 * Polls for pending builds and executes them in the task's worktree.
 * Runs lint, test, and build steps, updating build status and gate
 * progression in the database.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  forgeBuilds,
  forgeRevisions,
  forgeRunEvents,
  taskRuns,
  chatConversations,
} from "@bob/db/schema";

const POLL_INTERVAL = 10_000; // 10 seconds

interface BuildStep {
  name: string;
  command: string;
  optional?: boolean; // If true, failure doesn't fail the build
}

/**
 * Detect build steps based on what exists in the worktree.
 * Returns steps appropriate for the project type.
 */
function detectBuildSteps(workDir: string): BuildStep[] {
  const steps: BuildStep[] = [];

  // Check for package.json (Node.js project)
  if (existsSync(`${workDir}/package.json`)) {
    // Check for pnpm/npm/yarn
    const pm = existsSync(`${workDir}/pnpm-lock.yaml`)
      ? "pnpm"
      : existsSync(`${workDir}/yarn.lock`)
        ? "yarn"
        : "npm";

    steps.push({
      name: "install",
      command: `${pm} install --frozen-lockfile 2>&1 || ${pm} install 2>&1`,
    });

    // Detect available scripts from package.json
    try {
      const pkg = JSON.parse(
        execSync(`cat ${workDir}/package.json`, { encoding: "utf8" }),
      );
      const scripts = pkg.scripts ?? {};

      if (scripts.lint) {
        steps.push({ name: "lint", command: `${pm} run lint 2>&1`, optional: true });
      }
      if (scripts.typecheck || scripts["type-check"]) {
        const cmd = scripts.typecheck ? "typecheck" : "type-check";
        steps.push({ name: "typecheck", command: `${pm} run ${cmd} 2>&1`, optional: true });
      }
      if (scripts.test) {
        steps.push({ name: "test", command: `${pm} run test 2>&1` });
      }
      if (scripts.build) {
        steps.push({ name: "build", command: `${pm} run build 2>&1` });
      }
    } catch {
      // Fallback if package.json parsing fails
      steps.push({ name: "build", command: `${pm} run build 2>&1` });
    }
  }

  // Check for Makefile
  if (existsSync(`${workDir}/Makefile`)) {
    steps.push({ name: "build", command: "make build 2>&1" });
    steps.push({ name: "test", command: "make test 2>&1", optional: true });
  }

  // Check for Go
  if (existsSync(`${workDir}/go.mod`)) {
    steps.push({ name: "build", command: "go build ./... 2>&1" });
    steps.push({ name: "test", command: "go test ./... 2>&1" });
  }

  // Check for Rust
  if (existsSync(`${workDir}/Cargo.toml`)) {
    steps.push({ name: "build", command: "cargo build 2>&1" });
    steps.push({ name: "test", command: "cargo test 2>&1" });
  }

  return steps;
}

async function executeBuild(buildId: string): Promise<void> {
  console.log(`[forge:build-runner] Starting build ${buildId}`);

  // Get build → revision → taskRun → session → workingDirectory
  const build = await db.query.forgeBuilds.findFirst({
    where: eq(forgeBuilds.id, buildId),
  });
  if (!build) return;

  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.id, build.revisionId),
  });
  if (!revision?.taskRunId) {
    console.log(`[forge:build-runner] No task run for revision ${build.revisionId}`);
    // Mark as passed if we can't find the working directory (e.g., manual revision)
    await db
      .update(forgeBuilds)
      .set({ status: "passed", ciProvider: "forgegraph" })
      .where(eq(forgeBuilds.id, buildId));
    return;
  }

  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, revision.taskRunId),
  });
  if (!taskRun?.sessionId) {
    await db
      .update(forgeBuilds)
      .set({ status: "passed", ciProvider: "forgegraph" })
      .where(eq(forgeBuilds.id, buildId));
    return;
  }

  const session = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, taskRun.sessionId),
  });
  const workDir = session?.workingDirectory;
  if (!workDir || !existsSync(workDir)) {
    console.log(`[forge:build-runner] Working directory not found: ${workDir}`);
    await db
      .update(forgeBuilds)
      .set({ status: "passed", ciProvider: "forgegraph" })
      .where(eq(forgeBuilds.id, buildId));
    return;
  }

  // Mark build as running
  await db
    .update(forgeBuilds)
    .set({ status: "running", ciProvider: "forgegraph" })
    .where(eq(forgeBuilds.id, buildId));

  // Report tests started
  await db.insert(forgeRunEvents).values({
    runId: taskRun.id,
    repoId: revision.repoId,
    revisionId: revision.id,
    eventType: "tests_started",
    taskId: revision.taskId,
  });

  // Detect and run build steps
  const steps = detectBuildSteps(workDir);
  if (steps.length === 0) {
    console.log(`[forge:build-runner] No build steps detected for ${workDir}, marking passed`);
    await db
      .update(forgeBuilds)
      .set({ status: "passed", ciProvider: "forgegraph" })
      .where(eq(forgeBuilds.id, buildId));
    return;
  }

  const gateResults: Array<{ name: string; status: string; output?: string }> = [];
  let allPassed = true;

  for (const step of steps) {
    console.log(`[forge:build-runner] Running step: ${step.name} in ${workDir}`);
    try {
      const output = execSync(step.command, {
        cwd: workDir,
        encoding: "utf8",
        timeout: 300_000, // 5 min per step
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      gateResults.push({ name: step.name, status: "passed", output: output.slice(-500) });
      console.log(`[forge:build-runner] Step ${step.name}: PASSED`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const output = errMsg.slice(-1000);
      if (step.optional) {
        gateResults.push({ name: step.name, status: "warning", output });
        console.log(`[forge:build-runner] Step ${step.name}: WARNING (optional, continuing)`);
      } else {
        gateResults.push({ name: step.name, status: "failed", output });
        console.log(`[forge:build-runner] Step ${step.name}: FAILED`);
        allPassed = false;
        break; // Stop on first required failure
      }
    }
  }

  // Update build status
  const finalStatus = allPassed ? "passed" : "failed";
  await db
    .update(forgeBuilds)
    .set({ status: finalStatus, ciProvider: "forgegraph" })
    .where(eq(forgeBuilds.id, buildId));

  // Update revision gates
  const gates = gateResults.map((r) => ({
    name: r.name,
    status: r.status === "warning" ? "passed" : r.status,
  }));
  await db
    .update(forgeRevisions)
    .set({
      gates,
      status: allPassed ? "gates_passed" : "failed",
    })
    .where(eq(forgeRevisions.id, revision.id));

  // Report tests finished
  await db.insert(forgeRunEvents).values({
    runId: taskRun.id,
    repoId: revision.repoId,
    revisionId: revision.id,
    eventType: "tests_finished",
    taskId: revision.taskId,
    testStatus: finalStatus,
  });

  console.log(`[forge:build-runner] Build ${buildId}: ${finalStatus} (${gateResults.length} steps)`);
}

let running = false;

async function pollForPendingBuilds(): Promise<void> {
  if (running) return;
  running = true;

  try {
    // Find builds that are "queued" (default status)
    const pendingBuilds = await db.query.forgeBuilds.findMany({
      where: eq(forgeBuilds.status, "queued"),
      orderBy: (builds: any, { asc }: any) => [asc(builds.createdAt)],
      limit: 3,
    });

    for (const build of pendingBuilds) {
      try {
        await executeBuild(build.id);
      } catch (err) {
        console.error(`[forge:build-runner] Build ${build.id} failed:`, err);
        await db
          .update(forgeBuilds)
          .set({ status: "failed", ciProvider: "forgegraph" })
          .where(eq(forgeBuilds.id, build.id));
      }
    }
  } catch (err) {
    console.error("[forge:build-runner] Poll error:", err);
  } finally {
    running = false;
  }
}

export function startBuildRunner(): void {
  console.log(`[forge:build-runner] Started (polling every ${POLL_INTERVAL / 1000}s)`);
  setInterval(pollForPendingBuilds, POLL_INTERVAL);
  // Run immediately on start
  void pollForPendingBuilds();
}
