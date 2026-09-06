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
 * carrying task results. ci-check-phase captures fresh summaries with the CI
 * SHA/run/attempt; this gate requires every declared task and all three phases.
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
  const failed = tasks.filter(
    (t) =>
      t.execution?.exitCode !== 0 &&
      !(
        t.execution?.exitCode == null &&
        t.cache?.status === "HIT" &&
        typeof t.hash === "string" &&
        t.hash.length > 0
      ),
  );
  const blocking = failed.filter(
    (t) => closure.has(t.package) || t.evidenceError,
  );
  const nonBlocking = failed.filter(
    (t) => !closure.has(t.package) && !t.evidenceError,
  );
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
        evidenceError: true,
        package: `<unreadable:${file}>`,
        task: "?",
        execution: { exitCode: 1 },
      });
    }
  }
  return tasks;
}

export const CHECK_PHASES = ["typecheck", "lint", "test"];

export function ciProvenance(env = process.env) {
  const {
    CI_CHECK_SHA: sha,
    CI_CHECK_RUN_ID: runId,
    CI_CHECK_ATTEMPT: attempt,
  } = env;
  if (
    ![sha, runId, attempt].every((v) => typeof v === "string" && v.length > 0)
  ) {
    throw new Error("Missing CI check SHA, run ID, or attempt");
  }
  return { sha, runId, attempt };
}

export function expectedTasks() {
  const raw = execFileSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      ...CHECK_PHASES,
      ...DEPLOYED_APPS.map((app) => `--filter=${app}...`),
      "--dry=json",
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const tasks = JSON.parse(raw).tasks;
  if (!Array.isArray(tasks)) throw new Error("Invalid Turbo task graph");
  return tasks
    .filter(
      (t) => typeof t.command === "string" && t.command !== "<NONEXISTENT>",
    )
    .map((t) => `${t.package}#${t.task}`);
}

export function decideEvidence(evidence, closure, expected, provenance) {
  const errors = [];
  const tasks = [];
  if (
    !provenance ||
    ![provenance.sha, provenance.runId, provenance.attempt].every(Boolean)
  )
    errors.push("missing provenance");
  for (const phase of CHECK_PHASES) {
    const records = evidence.filter((e) => e.phase === phase);
    if (records.length !== 1)
      errors.push(`${phase}: expected exactly one completed phase`);
    for (const e of records) {
      if (["sha", "runId", "attempt"].some((k) => e[k] !== provenance?.[k]))
        errors.push(`${phase}: stale provenance`);
      if (
        ![0, 1].includes(e.exitCode) ||
        !Array.isArray(e.tasks) ||
        e.evidenceError
      )
        errors.push(`${phase}: incomplete evidence`);
      const recorded = Array.isArray(e.tasks) ? e.tasks : [];
      for (const id of expected.filter((id) => id.endsWith(`#${phase}`))) {
        if (!recorded.some((t) => `${t.package}#${t.task}` === id))
          errors.push(`${id}: missing task`);
      }
      if (
        e.exitCode !== 0 &&
        !recorded.some(
          (t) =>
            Number.isInteger(t.execution?.exitCode) &&
            t.execution.exitCode !== 0,
        )
      )
        errors.push(`${phase}: unexplained command failure`);
      tasks.push(...recorded);
    }
  }
  if (evidence.some((e) => !CHECK_PHASES.includes(e.phase)))
    errors.push("unknown or unreadable phase evidence");
  for (const id of expected) {
    if (!tasks.some((t) => `${t.package}#${t.task}` === id))
      errors.push(`${id}: missing prerequisite task`);
  }
  const report = decide(tasks, closure);
  return {
    ...report,
    errors,
    deployable: report.deployable && errors.length === 0,
  };
}

export function readEvidence(dir = join(repoRoot, ".turbo", "ci-evidence")) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf8"));
        } catch {
          return { evidenceError: true };
        }
      });
  } catch {
    return [];
  }
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

  let report;
  try {
    const provenance = ciProvenance();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (head !== provenance.sha)
      throw new Error("Checkout SHA does not match CI check SHA");
    report = decideEvidence(
      readEvidence(),
      closure,
      expectedTasks(),
      provenance,
    );
  } catch (error) {
    console.error(`Deployment blocked: ${error.message}`);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Deployable closure: ${report.closureSize} packages · ` +
        `${report.tasksRecorded} tasks recorded · ${report.failed.length} failed`,
    );
    for (const error of report.errors) console.log(`  ✗ ${error}`);
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
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
