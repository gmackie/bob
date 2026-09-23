#!/usr/bin/env node
// Prepare once in the checking job; publish/replay without installing workspace dependencies.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const endpoint = "https://forgegraf.com/api/fg/ci/report";
const statuses = new Set(["success", "failure", "cancelled"]);

function provenance(env) {
  if (!/^[a-f0-9]{40,64}$/.test(env.CI_CHECK_SHA ?? "") ||
      !/^\d+$/.test(env.CI_CHECK_RUN_ID ?? "") ||
      !/^\d+$/.test(env.CI_CHECK_ATTEMPT ?? "") ||
      !/^\d+$/.test(env.GITHUB_RUN_NUMBER ?? "") ||
      !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")) {
    throw new Error("Missing or invalid CI provenance");
  }
  const server = new URL(env.GITHUB_SERVER_URL);
  if (server.protocol !== "https:" || server.username || server.password) throw new Error("Invalid CI provenance server");
  return {
    sha: env.CI_CHECK_SHA, runId: env.CI_CHECK_RUN_ID, runAttempt: env.CI_CHECK_ATTEMPT,
    runUrl: `${server.origin}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_NUMBER}`,
  };
}

export function buildReport(env, tests) {
  const identity = provenance(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const branch = env.CI_REPORT_BRANCH;
  if (typeof branch !== "string" || !branch || branch.length > 512) throw new Error("Invalid CI branch");
  const passed = env.CI_JOB_STATUS === "success" &&
    [env.CI_TYPECHECK, env.CI_LINT, env.CI_TEST].every(result => result === "success");
  return {
    owner, repo, ...identity, branch, workflowName: "CI",
    status: env.CI_JOB_STATUS === "cancelled" ? "cancelled" : passed ? "success" : "failure",
    ...(tests ? { tests } : {}),
  };
}

export async function saveReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function loadReport(path, env) {
  if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("CI report exceeds size limit");
  const report = JSON.parse(await readFile(path, "utf8"));
  const identity = provenance(env);
  if (Object.entries(identity).some(([key, value]) => report[key] !== value) ||
      `${report.owner}/${report.repo}` !== env.GITHUB_REPOSITORY ||
      report.workflowName !== "CI" || !statuses.has(report.status) ||
      typeof report.branch !== "string" || !report.branch) {
    throw new Error("CI report provenance mismatch");
  }
  return report;
}

export function settledReport(report, sourceResult, researchResult) {
  // A saved successful main-job result must never hide a failed prerequisite.
  if (sourceResult === "success" && researchResult === "success") return report;
  return { ...report, status: [sourceResult, researchResult].includes("cancelled") ? "cancelled" : "failure" };
}

export async function loadReportOrFailure(path, env) {
  try {
    return await loadReport(path, env);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A killed runner may never upload an artifact. Native job outcomes can
    // establish failure, but cannot prove that every source check passed.
    return buildReport({
      ...env,
      CI_JOB_STATUS: [env.CI_SOURCE_RESULT, env.CI_RESEARCH_RESULT].includes("cancelled")
        ? "cancelled" : "failure",
      CI_TYPECHECK: undefined, CI_LINT: undefined, CI_TEST: undefined,
    });
  }
}

class PermanentFailure extends Error {}

export async function sendReport(report, options = {}) {
  const { token, endpoint: url = endpoint, timeoutMs = 15000, maxAttempts = 4, retryDelayMs = 1000 } = options;
  if (!token) throw new Error("FG_CI_TOKEN is required; saved report can be replayed later");
  const body = JSON.stringify(report);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 408 || response.status === 429 || response.status >= 500) throw new Error("Transient HTTP failure");
        throw new PermanentFailure(`ForgeGraph CI report rejected: HTTP ${response.status}`);
      }
      let size = 0; const chunks = [];
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > 65536) throw new PermanentFailure("Invalid CI report acknowledgement: too large");
        chunks.push(chunk);
      }
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new PermanentFailure("Invalid CI report acknowledgement"); }
      const expected = { success: "passed", failure: "failed", cancelled: "cancelled" }[report.status];
      if (result?.ok !== true || typeof result.buildId !== "string" || !result.buildId || result.status !== expected) {
        throw new PermanentFailure("Invalid CI report acknowledgement");
      }
      return result;
    } catch (error) {
      if (error instanceof PermanentFailure) throw error;
      if (attempt === maxAttempts) throw new Error(`ForgeGraph CI report unavailable after ${maxAttempts} attempts; replay the saved report`);
      await delay(retryDelayMs);
    }
  }
}

async function main() {
  const [command, path] = process.argv.slice(2);
  if (!["prepare", "send"].includes(command) || !path) throw new Error("Usage: node scripts/ci-report.mjs <prepare|send> <report.json>");
  if (command === "prepare") {
    let summary;
    try {
      const { parseCheckEventLine, summarizeChecks } = await import("@forgegraph/check-events");
      const events = (await readFile(process.env.FG_CHECK_EVENTS_PATH, "utf8")).split("\n").map(parseCheckEventLine).filter(Boolean);
      summary = summarizeChecks(events);
      for (const phase of summary.phases) phase.failures = phase.failures.slice(0, 20);
    } catch {
      // Early install failures still produce an honest failure report without counts.
      console.error("Check-event summary unavailable; report will retain native outcomes only");
    }
    await saveReport(path, buildReport(process.env, summary));
    console.log("CI report saved for independent publication");
  } else {
    const report = settledReport(await loadReportOrFailure(path, process.env), process.env.CI_SOURCE_RESULT, process.env.CI_RESEARCH_RESULT);
    const result = await sendReport(report, { token: process.env.FG_CI_TOKEN });
    console.log(`ForgeGraph CI report accepted: ${result.buildId} (${result.status})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
