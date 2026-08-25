#!/usr/bin/env node
/**
 * Decide whether a CI run's failures should block deployment.
 *
 * Both deploy jobs used to gate on the whole `ci` job, so a lint error in any
 * package stopped every deploy in the repo. On 2026-08-23/24 that happened
 * three times; twice the culprit was `@bob/mobile`, which nothing we deploy
 * depends on. The web worker could not ship because an Expo app had a Metro
 * shim outside its tsconfig.
 *
 * Splitting `ci` into parallel per-app jobs is not an option here: that job's
 * own comments record concurrent tsc getting OOM-killed and concurrent eslint
 * driving the shared runner's load average to 150. So rather than running
 * checks more times, this reads what the single serialized run already
 * recorded.
 *
 * Turbo's `--summarize` writes one JSON per invocation under `.turbo/runs/`,
 * carrying an exit code per package/task. This intersects the failures with
 * the dependency closure of the deployed apps.
 *
 *   node scripts/ci-deployable-gate.mjs [--json]
 *
 * Exit 0 when deployment may proceed, 1 when it must not. Fails closed: if the
 * closure cannot be resolved, or no summaries exist, deployment is blocked.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The apps a push to master actually deploys. Keep in step with ci.yml. */
export const DEPLOYED_APPS = ["@bob/blder", "@gmacko/ooda-edge"];

/**
 * The decision itself, kept pure so it can be tested without invoking turbo or
 * touching the filesystem. `tasks` is turbo's summary shape; `closure` is the
 * set of package names the deployed apps depend on.
 */
export function decide(tasks, closure) {
  const failed = tasks.filter((t) => (t.execution?.exitCode ?? 0) !== 0);
  const blocking = failed.filter((t) => closure.has(t.package));
  const nonBlocking = failed.filter((t) => !closure.has(t.package));
  const name = (t) => `${t.package}#${t.task}`;
  return {
    closureSize: closure.size,
    tasksRecorded: tasks.length,
    failed: failed.map(name).sort(),
    blocking: blocking.map(name).sort(),
    nonBlocking: nonBlocking.map(name).sort(),
    deployable: blocking.length === 0,
  };
}

/** Every package the deployed apps depend on, transitively (`...` suffix). */
export function deployableClosure() {
  const args = ["turbo", "ls", "--output=json"];
  for (const app of DEPLOYED_APPS) args.push(`--filter=${app}...`);
  const raw = execFileSync("pnpm", ["exec", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  const packages = parsed.packages;
  const items = Array.isArray(packages) ? packages : packages?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("turbo ls returned no packages for the deployed apps");
  }
  return new Set(
    items.map((entry) => (typeof entry === "string" ? entry : entry.name)),
  );
}

/** Every task turbo recorded across this run's invocations. */
export function recordedTasks(dir = join(repoRoot, ".turbo", "runs")) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const tasks = [];
  for (const file of files) {
    const full = join(dir, file);
    if (!statSync(full).isFile()) continue;
    try {
      const summary = JSON.parse(readFileSync(full, "utf8"));
      for (const task of summary.tasks ?? []) tasks.push(task);
    } catch {
      // A truncated summary is not evidence of success — surface it as a
      // failing signal rather than silently skipping it.
      tasks.push({
        package: `<unreadable:${file}>`,
        task: "?",
        execution: { exitCode: 1 },
      });
    }
  }
  return tasks;
}

function main() {
  const wantJson = process.argv.includes("--json");

  let closure;
  try {
    closure = deployableClosure();
  } catch (err) {
    console.error(
      `Cannot resolve the deployable closure, so deployment is blocked: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }

  const tasks = recordedTasks();
  if (tasks.length === 0) {
    console.error(
      "No turbo run summaries found under .turbo/runs — the checks either did " +
        "not run or were not invoked with --summarize. Blocking deployment.",
    );
    process.exit(1);
  }

  const report = decide(tasks, closure);

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Deployable closure: ${report.closureSize} packages · ` +
        `${report.tasksRecorded} tasks recorded · ${report.failed.length} failed`,
    );
    for (const t of report.nonBlocking) {
      console.log(`  · ${t} — failed, but nothing we deploy depends on it`);
    }
    for (const t of report.blocking) {
      console.log(`  ✗ ${t} — inside the deployable closure`);
    }
    console.log(
      report.deployable
        ? "Deployment may proceed."
        : "Deployment blocked: a package the deployed apps depend on failed.",
    );
  }

  process.exit(report.deployable ? 0 : 1);
}

// Only run the CLI when executed directly — importing this module for `decide`
// in tests must not exit the process.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
