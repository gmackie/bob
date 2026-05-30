#!/usr/bin/env node
/**
 * Bob Task Runner
 *
 * Polls Linear for unstarted issues across startup projects, picks the highest
 * priority one, dispatches codex to work on it, and reports the run (status +
 * output) to Bob's public API so it's monitorable/reviewable in the dashboard.
 *
 * Usage: node task-runner.js [--dry-run] [--startup <slug>] [--once]
 *
 * Env:
 *   LINEAR_API_KEY        Linear API key (falls back to LINEAR_KEY_FILE contents)
 *   LINEAR_KEY_FILE       Path to a file holding the Linear key (default /home/bob/.linear-key)
 *   PULSE_API_KEY         BizPulse key passed to codex (optional)
 *   BOB_API_URL           Bob base URL for run reporting (e.g. https://bob.blder.bot)
 *   BOB_API_KEY           Bob API key (bob_live_...) with write permission
 *   BOB_WORKSPACE_ID      Bob workspace to record runs under
 *   BOB_RUNNER_STATE_DIR  State/log dir (default /home/bob/.bob-runner)
 *   BOB_RUNNER_REPOS      JSON map slug -> repo dir (optional override)
 *   BOB_RUNNER_PROJECTS   JSON map slug -> Linear project id (optional override)
 *   LINEAR_TEAM_ID        Linear team id (default below)
 */
const { execSync, spawn } = require("child_process");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");

const LINEAR_KEY_FILE = process.env.LINEAR_KEY_FILE || "/home/bob/.linear-key";
const LINEAR_KEY =
  process.env.LINEAR_API_KEY ||
  (existsSync(LINEAR_KEY_FILE) ? readFileSync(LINEAR_KEY_FILE, "utf8").trim() : "");
// Secret comes from the environment — never hard-code it in the repo.
const PULSE_API_KEY = process.env.PULSE_API_KEY || "";
const STATE_DIR = process.env.BOB_RUNNER_STATE_DIR || "/home/bob/.bob-runner";
const LOG_DIR = join(STATE_DIR, "logs");
const MAX_RUNTIME_MS = 20 * 60 * 1000; // 20 min per issue

// Startup slug -> repo dir on the runner host.
const DEFAULT_REPOS = {
  appealkey: "/home/bob/dev/appealkey",
  habitplay: "/home/bob/dev/habit-app",
  playtrek: "/home/bob/dev/playtrek",
  driftport: "/home/bob/dev/driftport",
  latchflow: "/home/bob/dev/latchflow",
  levelforge: "/home/bob/dev/levelforge",
  forgegraph: "/home/bob/dev/bob",
  streamconductor: "/home/bob/dev/streamconductor",
  classcheck: "/home/bob/dev/class-check",
  controlsfoundry: "/home/bob/dev/controlsfoundry",
  gentrellis: "/home/bob/dev/gentrellis",
  bob: "/home/bob/dev/bob",
  bizpulse: "/home/bob/dev/bob",
};

// Startup slug -> Linear project ID.
const DEFAULT_PROJECTS = {
  appealkey: "6470095d-da6b-4d43-9a7a-0b40d76057af",
  habitplay: "c9607479-57c6-4652-bf24-e7c3f7137e14",
  playtrek: "eafba504-d3e5-4873-8a86-4711caa9cd0c",
  driftport: "da45f496-bc56-4d1c-98cf-60d1051a5600",
  latchflow: "f1f65d1a-2f82-4a7f-8bc8-4335b9282fb1",
  levelforge: "98e36fe3-0859-4357-a852-f9dacee2d3f1",
  forgegraph: "48fedca7-94be-4194-a525-6688664731c7",
  streamconductor: "448e1bd5-7795-4500-a3f4-c13a9e5ca832",
  classcheck: "28498543-00ea-4cbb-8fec-32170773a997",
  controlsfoundry: "40c155ef-54e0-40f3-85a8-ca328056b973",
  gentrellis: "06681f23-8a40-4bf8-9ee5-8c7f7f2a72eb",
  bob: "22b9ea42-2b01-4a67-b849-042b61d0853b",
  bizpulse: "7eb8413c-4d5a-42b6-9834-f1f93a17d487",
};

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    console.log(`[runner] ignoring invalid JSON in ${name}`);
    return fallback;
  }
}

const REPOS = parseJsonEnv("BOB_RUNNER_REPOS", DEFAULT_REPOS);
const PROJECTS = parseJsonEnv("BOB_RUNNER_PROJECTS", DEFAULT_PROJECTS);
const TEAM_ID = process.env.LINEAR_TEAM_ID || "5027d80c-70dc-4c48-b88b-40053c03aec3";

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONCE = args.includes("--once");
const STARTUP_FILTER = args.includes("--startup") ? args[args.indexOf("--startup") + 1] : null;

// --- Bob run reporting (best-effort; never breaks the runner) ---
const BOB_API_URL = process.env.BOB_API_URL;
const BOB_API_KEY = process.env.BOB_API_KEY;
const BOB_WORKSPACE_ID = process.env.BOB_WORKSPACE_ID;
const BOB_REPORT = !!(BOB_API_URL && BOB_API_KEY && BOB_WORKSPACE_ID);

async function bobApi(method, path, body) {
  if (!BOB_REPORT) return null;
  try {
    const r = await fetch(BOB_API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + BOB_API_KEY },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.log("[bob-report] " + method + " " + path + " -> " + r.status);
      return null;
    }
    return await r.json().catch(() => ({}));
  } catch (e) {
    console.log("[bob-report] " + method + " " + path + " failed: " + e.message);
    return null;
  }
}

// Open the run as soon as the issue is claimed (before the slow Linear/git
// phase) so it shows up immediately for monitoring.
async function bobStartRun(issue, slug) {
  const run = await bobApi("POST", "/api/v1/runs", {
    workItemId: issue.identifier,
    workspaceId: BOB_WORKSPACE_ID,
    agentType: "codex",
    agentConfig: { title: issue.title, slug },
  });
  const id = run && run.id;
  if (id) await bobApi("PATCH", "/api/v1/runs/" + id, { status: "running" });
  return id || null;
}

async function bobPushLog(runId, output) {
  if (!runId || !output) return;
  const tail = output.length > 60000 ? output.slice(-60000) : output;
  await bobApi("POST", "/api/v1/runs/" + runId + "/artifacts", {
    type: "log",
    storageKey: "inline:" + runId + ":log",
    metadata: { content: tail },
  });
}

async function bobFinishRun(runId, status, summary) {
  if (!runId) return;
  await bobApi("PATCH", "/api/v1/runs/" + runId, { status, summary });
}
// --- end Bob run reporting ---

async function linearQuery(query, variables = {}) {
  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await resp.json();
  if (data.errors?.length) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function getUnstartedIssues(projectId) {
  const data = await linearQuery(`
    query($projectId: ID!) {
      issues(
        filter: {
          project: { id: { eq: $projectId } }
          state: { type: { in: ["backlog", "unstarted", "triage"] } }
        }
        first: 20
        orderBy: updatedAt
      ) {
        nodes {
          id identifier title description priority
          state { name type }
          labels { nodes { name } }
        }
      }
    }
  `, { projectId });
  return data.issues?.nodes || [];
}

async function updateIssueState(issueId, stateType) {
  // Find the state ID for the target type
  const data = await linearQuery(`
    query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name type }
      }
    }
  `, { teamId: TEAM_ID });

  const states = data.workflowStates?.nodes || [];
  const target = states.find(s => s.type === stateType);
  if (!target) return;

  await linearQuery(`
    mutation($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
      }
    }
  `, { issueId, stateId: target.id });
}

async function addIssueComment(issueId, body) {
  await linearQuery(`
    mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }
  `, { issueId, body });
}

function getSlugForProject(projectId) {
  for (const [slug, pid] of Object.entries(PROJECTS)) {
    if (pid === projectId) return slug;
  }
  return null;
}

function getRepoDir(slug) {
  return REPOS[slug] || null;
}

function getClaimedFile() {
  return join(STATE_DIR, "claimed.json");
}

function loadClaimed() {
  const f = getClaimedFile();
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
}

function saveClaimed(data) {
  writeFileSync(getClaimedFile(), JSON.stringify(data, null, 2));
}

function isClaimed(issueId) {
  const claimed = loadClaimed();
  return !!claimed[issueId];
}

function markClaimed(issueId, slug, status = "in_progress") {
  const claimed = loadClaimed();
  claimed[issueId] = { slug, status, startedAt: new Date().toISOString() };
  saveClaimed(claimed);
}

function markDone(issueId, status) {
  const claimed = loadClaimed();
  if (claimed[issueId]) {
    claimed[issueId].status = status;
    claimed[issueId].completedAt = new Date().toISOString();
  }
  saveClaimed(claimed);
}

async function runCodex(repoDir, prompt, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m", "gpt-5.5",
      "-o", logFile,
      prompt,
    ], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PULSE_API_KEY,
        PULSE_API_URL: "https://bizpulse.cc",
      },
    });

    let output = "";
    child.stdout?.on("data", d => { output += d.toString(); });
    child.stderr?.on("data", d => { output += d.toString(); });

    const timeout = setTimeout(() => {
      console.log(`[runner] Timeout, killing codex`);
      child.kill("SIGTERM");
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
    }, MAX_RUNTIME_MS);

    child.on("close", code => {
      clearTimeout(timeout);
      resolve({ exitCode: code, output });
    });

    child.on("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function processIssue(issue, slug, repoDir) {
  const branchName = `bob/${issue.identifier.toLowerCase()}`;
  const logFile = join(LOG_DIR, `${issue.identifier}-${Date.now()}.txt`);

  console.log(`[runner] Processing ${issue.identifier}: ${issue.title}`);
  console.log(`[runner] Repo: ${repoDir}, Branch: ${branchName}`);

  if (DRY_RUN) {
    console.log(`[runner] DRY RUN -- would run codex here`);
    return "dry_run";
  }

  // Open the Bob run at claim time so it's visible immediately (the Linear
  // update + git setup below can take minutes before codex starts).
  const bobRunId = await bobStartRun(issue, slug);

  // Mark as in-progress in Linear
  try {
    await updateIssueState(issue.id, "started");
    await addIssueComment(issue.id, `🤖 Bob agent claiming this issue.\n\nBranch: \`${branchName}\`\nRunner: codex/gpt-5.5\nRepo: ${repoDir}`);
  } catch (e) {
    console.log(`[runner] Failed to update Linear: ${e.message}`);
  }

  // Create branch
  try {
    execSync(`git checkout main 2>/dev/null || git checkout master`, { cwd: repoDir, stdio: "pipe" });
    execSync(`git pull --ff-only 2>/dev/null || true`, { cwd: repoDir, stdio: "pipe" });
    execSync(`git checkout -B ${branchName}`, { cwd: repoDir, stdio: "pipe" });
  } catch (e) {
    console.log(`[runner] Git setup failed: ${e.message}`);
  }

  const prompt = `You are an AI agent working on issue ${issue.identifier} for the ${slug} startup.

## Issue
**${issue.title}**

${issue.description || "No description provided."}

## Instructions
1. Read CLAUDE.md to understand the project
2. Find the relevant code referenced in the issue description
3. Implement the fix with minimal changes
4. Run any available tests to verify your changes
5. Create a git commit with a descriptive message referencing ${issue.identifier}

If you cannot fully resolve the issue, make as much progress as possible and document what remains in a commit message.

Do NOT modify unrelated files. Stay focused on this specific issue.`;

  console.log(`[runner] Starting codex...`);
  const result = await runCodex(repoDir, prompt, logFile);
  console.log(`[runner] Codex exited with code ${result.exitCode}`);
  await bobPushLog(bobRunId, result.output);

  // Check if any commits were made
  let hasCommits = false;
  try {
    const diffCount = execSync(`git log main..HEAD --oneline 2>/dev/null | wc -l`, {
      cwd: repoDir, encoding: "utf8"
    }).trim();
    hasCommits = parseInt(diffCount) > 0;
  } catch {
    try {
      const diffCount = execSync(`git log master..HEAD --oneline 2>/dev/null | wc -l`, {
        cwd: repoDir, encoding: "utf8"
      }).trim();
      hasCommits = parseInt(diffCount) > 0;
    } catch {}
  }

  if (hasCommits) {
    console.log(`[runner] Commits found, pushing branch`);
    try {
      execSync(`git push -u origin ${branchName} --force`, { cwd: repoDir, stdio: "pipe" });
    } catch (e) {
      console.log(`[runner] Push failed: ${e.message}`);
    }

    try {
      await addIssueComment(issue.id, `✅ Bob agent completed work on branch \`${branchName}\`.\n\nReview the changes and merge when ready.`);
    } catch {}

    await bobFinishRun(bobRunId, "completed", { exitCode: result.exitCode });
    return "completed";
  } else {
    console.log(`[runner] No commits made`);
    try {
      await addIssueComment(issue.id, `⚠️ Bob agent attempted this issue but did not produce commits.\n\nLog: ${logFile}\nMay need manual intervention.`);
      await updateIssueState(issue.id, "unstarted");
    } catch {}

    // Clean up branch
    try {
      execSync(`git checkout main 2>/dev/null || git checkout master`, { cwd: repoDir, stdio: "pipe" });
      execSync(`git branch -D ${branchName} 2>/dev/null || true`, { cwd: repoDir, stdio: "pipe" });
    } catch {}

    await bobFinishRun(bobRunId, "failed", { exitCode: result.exitCode, reason: "no_commits" });
    return "no_changes";
  }
}

async function runOnce() {
  console.log(`[runner] Scanning for work...`);

  const targetSlugs = STARTUP_FILTER ? [STARTUP_FILTER] : Object.keys(PROJECTS);

  // Collect all issues across all startups, then pick the highest priority globally
  const allCandidates = [];

  for (const slug of targetSlugs) {
    const projectId = PROJECTS[slug];
    const repoDir = getRepoDir(slug);
    if (!projectId || !repoDir) continue;
    if (!existsSync(repoDir)) continue;

    try {
      const issues = await getUnstartedIssues(projectId);
      for (const issue of issues) {
        if (!isClaimed(issue.id)) {
          allCandidates.push({ issue, slug, repoDir });
        }
      }
    } catch (e) {
      console.log(`[runner] Failed to fetch issues for ${slug}: ${e.message}`);
    }
  }

  if (allCandidates.length === 0) {
    console.log(`[runner] No unclaimed issues found`);
    return false;
  }

  // Sort by priority (1=urgent first), then by identifier (newer = higher number = from audits)
  allCandidates.sort((a, b) => {
    const pa = a.issue.priority || 4;
    const pb = b.issue.priority || 4;
    if (pa !== pb) return pa - pb;
    // Prefer higher issue numbers (audit issues are newer)
    const na = parseInt(a.issue.identifier.replace(/\D/g, "")) || 0;
    const nb = parseInt(b.issue.identifier.replace(/\D/g, "")) || 0;
    return nb - na;
  });

  const { issue, slug, repoDir } = allCandidates[0];
  console.log(`[runner] Found: ${issue.identifier} (P${issue.priority}) - ${issue.title} [${slug}]`);
  console.log(`[runner] ${allCandidates.length} total unclaimed issues across ${targetSlugs.length} startups`);

  markClaimed(issue.id, slug);

  try {
    const status = await processIssue(issue, slug, repoDir);
    markDone(issue.id, status);
    console.log(`[runner] ${issue.identifier} -> ${status}`);
    return true;
  } catch (e) {
    console.error(`[runner] Error processing ${issue.identifier}: ${e.message}`);
    markDone(issue.id, "error");
    return true;
  }
}

async function main() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  console.log(`[runner] Bob Task Runner starting`);
  console.log(`[runner] Mode: ${DRY_RUN ? "dry-run" : "live"}, Once: ${ONCE}, Filter: ${STARTUP_FILTER || "all"}`);
  console.log(`[runner] Bob reporting: ${BOB_REPORT ? "on" : "off"}`);

  if (ONCE) {
    await runOnce();
    return;
  }

  // Continuous mode: run one issue, wait 2 min, repeat
  while (true) {
    const didWork = await runOnce();
    const waitMs = didWork ? 120_000 : 600_000; // 2 min after work, 10 min if idle
    console.log(`[runner] Waiting ${waitMs / 1000}s...`);
    await new Promise(r => setTimeout(r, waitMs));
  }
}

main().catch(e => {
  console.error(`[runner] Fatal: ${e.message}`);
  process.exit(1);
});
