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
  // Playbook lane ONLY (see runOnce): the pulse checkout exists so
  // growth.offer_synthesis can deliver docs/ai/OFFER_CANDIDATES.md, not so
  // the runner starts coding pulse backlog issues unsupervised.
  bizpulse: "/home/bob/dev/pulse",
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

// --- Remote slug→{project, repo} map served by Pulse ------------------
// Source of truth is Pulse's startup/connector/startup_repo rows (company
// factory Q4): provisioning writes rows there and this runner picks them
// up on the next scan — no more SSH hand-edits. Remote entries win over
// the hardcoded defaults; the defaults remain the fallback when Pulse is
// unreachable. Repos missing on disk are cloned lazily at claim time.
const REMOTE_CONFIG_URL =
  (process.env.PULSE_API_URL || "https://bizpulse.cc") +
  "/api/gtm/runner-config";
let _remoteRepos = {}; // slug -> { projectId, provider, repoSlug, localPath }

async function refreshRemoteConfig() {
  const secret = process.env.PULSE_SERVICE_SECRET;
  if (!secret) return;
  try {
    const res = await fetch(REMOTE_CONFIG_URL, {
      headers: { Authorization: "Bearer " + secret },
    });
    if (!res.ok) {
      console.log(`[runner] remote config fetch -> ${res.status}`);
      return;
    }
    const data = await res.json();
    if (data && typeof data.repos === "object" && data.repos !== null) {
      _remoteRepos = data.repos;
    }
  } catch (e) {
    console.log(`[runner] remote config fetch failed: ${e.message}`);
  }
}

function remoteEntry(slug) {
  const r = _remoteRepos[slug];
  if (!r || !r.projectId || !r.repoSlug) return null;
  const dir =
    r.localPath || "/home/bob/dev/" + r.repoSlug.split("/").pop();
  // The forge is canonical (several repos exist ONLY there); github is a
  // mirror for some. Try in that order.
  const cloneUrls = [
    "git@git.forgegraf.com:" + r.repoSlug + ".git",
    "git@github.com:" + r.repoSlug + ".git",
  ];
  return { projectId: r.projectId, repoDir: dir, cloneUrls };
}

function effectiveProjects() {
  const merged = { ...PROJECTS };
  for (const [slug, r] of Object.entries(_remoteRepos)) {
    if (r && r.projectId) merged[slug] = r.projectId;
  }
  return merged;
}

function effectiveRepoDir(slug) {
  const remote = remoteEntry(slug);
  if (remote) return remote.repoDir;
  return getRepoDir(slug);
}

// A startup present in the remote config with a Linear project but NO repoSlug
// is a repo-optional (knowledge/ops) target — e.g. a portfolio company with no
// code repo whose only agent work is "Refresh stale KB entries" and similar
// targetSystem:"manual" tasks. Its issues are claimed and run in a scratch dir
// with no clone, no branch, no commit. remoteEntry() returns null for these
// (it requires repoSlug), so we detect them straight off the raw config.
function isRepoOptional(slug) {
  const r = _remoteRepos[slug];
  return !!(r && r.projectId && !r.repoSlug);
}

// A throwaway working directory for repo-optional issues. The agent gets its
// instructions from the issue description and does API/CLI work; the dir is
// just a cwd it doesn't need to be a repo.
function scratchDirFor(slug) {
  const dir = join(STATE_DIR, "scratch", slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Slugs whose clone recently failed, mapped to the failure timestamp. A failed
// slug is benched for CLONE_FAIL_COOLDOWN_MS so a repo that exists nowhere (a
// stale/wrong startup_repo row) can't burn a scan slot every cycle — but the
// bench EXPIRES so a *transient* clone failure (a momentary forge/network blip
// on a repo that really does exist) self-heals on the next scan after the
// cooldown, instead of benching a good repo until the process restarts.
const CLONE_FAIL_COOLDOWN_MS = 30 * 60_000; // 30 min
const _cloneFailed = new Map(); // slug -> last failure timestamp (ms)

// Pure (exported for tests): is this slug currently benched for a recent clone
// failure? `cloneFailed` is the slug->timestamp map.
function cloneBenched(slug, cloneFailed, now, cooldownMs = CLONE_FAIL_COOLDOWN_MS) {
  const t = cloneFailed.get(slug);
  return t != null && now - t < cooldownMs;
}

// Clone a missing repo at claim time so provisioning a new company needs
// zero host access. Returns true when the dir exists (already or after
// cloning). Tries the forge first (canonical), then the github mirror.
function ensureRepoDir(slug) {
  const remote = remoteEntry(slug);
  const dir = remote ? remote.repoDir : getRepoDir(slug);
  if (!dir) return false;
  if (existsSync(dir)) return true;
  if (!remote) return false;
  for (const url of remote.cloneUrls) {
    try {
      console.log(`[runner] cloning ${url} -> ${dir}`);
      execSync(`git clone --depth 20 ${url} ${dir}`, {
        stdio: "pipe",
        timeout: 300000,
        env: {
          ...process.env,
          GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new",
        },
      });
      if (existsSync(dir)) return true;
    } catch (e) {
      console.log(`[runner] clone failed (${url}): ${e.message.split("\n")[0]}`);
    }
  }
  _cloneFailed.set(slug, Date.now());
  return false;
}

// --- Candidate gates (pure, exported for tests) ------------------------
// These mirror the per-slug and per-issue filtering the scan loop applies.
// They are pure so the selection rules can be regression-tested without the
// network / filesystem / git the runner otherwise needs.

// A slug is eligible to be scanned this cycle when it has a project + repo,
// hasn't failed to clone earlier THIS process, and either exists on disk or
// can be lazily cloned from the remote config.
//
// The `cloneFailed` guard is the fix for the head-of-line stall: without it,
// a single un-clonable high-priority issue (a stale/wrong startup_repo row
// pointing at a repo that exists nowhere — e.g. `gmackie/classcheck`) is
// re-selected every cycle, unclaimed when the clone fails, then re-selected
// again, starving every other startup's work forever. ensureRepoDir populates
// _cloneFailed on a failed clone; this is the read the claim-time guard always
// assumed existed ("the slug goes on _cloneFailed, so this process won't
// thrash on it").
function slugEligible(slug, { projectId, repoDir, cloneBenched, repoExists, hasRemote, repoOptional }) {
  if (!projectId) return false;
  if (cloneBenched) return false;
  // Repo-optional (knowledge/ops) startups have a Linear project but no code
  // repo; their issues run in a scratch dir with no clone, so they need neither
  // a repoDir nor a remote to be materializable.
  if (repoOptional) return true;
  if (!repoDir) return false;
  // Missing dirs are fine when the remote config can clone them at claim
  // time; only skip when we'd have no way to materialize the repo.
  if (!repoExists && !hasRemote) return false;
  return true;
}

// An individual issue is claimable when it passes the bizpulse growth-marker
// gate and the staleness gate. `defaultSlugs` is the set of hardcoded slugs.
//
// bizpulse project holds founder/ops work orders that are NOT for autonomous
// execution — only genuine GTM playbook dispatches (which carry the marker
// emitted by buildGtmPlaybookInstructions) may be claimed there. Title alone
// is not enough: July's bulk objective work orders are also [pulse]-titled,
// and letting an agent execute one ended with it self-grading a business
// objective 'achieved' (GMA-385).
//
// STALE issues are never auto-claimed when the claim only became possible
// today (remote-config slugs, freshly clonable repos): month-old [pulse] work
// orders and backlog need a deliberate re-dispatch (the roadmap's ↻ refresh)
// before an agent acts on them — GMA-385/364 both started as silent
// stale-claims. Rules: [pulse]-titled operating work orders are fresh-only
// EVERYWHERE; remote-only slugs are fresh-only for everything.
function issueClaimable(slug, issue, { now, defaultSlugs }) {
  if (
    slug === "bizpulse" &&
    !(issue.description || "").includes("## Agent Instructions — growth.")
  ) {
    return false;
  }
  const ageMs = issue.updatedAt ? now - Date.parse(issue.updatedAt) : Infinity;
  const stale = ageMs > 14 * 86_400_000;
  if (stale && issue.title.startsWith("[pulse]")) return false;
  if (stale && !defaultSlugs.has(slug)) return false;
  return true;
}
// --- end remote config -------------------------------------------------
const TEAM_ID = process.env.LINEAR_TEAM_ID || "5027d80c-70dc-4c48-b88b-40053c03aec3";


// --- Agent preference & health ---
const AGENT_PREFERENCE = (process.env.BOB_AGENT_PREFERENCE || "claude,codex,grok").split(",").map(s => s.trim());

function checkAgentHealth() {
  const results = [];
  for (const agent of AGENT_PREFERENCE) {
    try {
      const out = require("child_process").execSync(
        "node /opt/bob/scripts/agent-health.js --agent " + agent,
        { encoding: "utf8", timeout: 30000 }
      );
      const report = JSON.parse(out);
      const a = report.agents[0];
      results.push(a);
      const icon = a.status === "ok" ? "OK" : a.status === "rate_limited" ? "LIMIT" : a.status === "auth_expired" ? "EXPIRED" : "FAIL";
      console.log("[runner] Agent " + icon + " " + a.name + " " + (a.version || "") + " - " + a.status + (a.reason ? " (" + a.reason + ")" : ""));
    } catch (e) {
      results.push({ name: agent, status: "error", reason: e.message.split("\n")[0] });
      console.log("[runner] Agent FAIL " + agent + " - check failed");
    }
  }
  return results;
}

let _agentHealthCache = null;
let _agentHealthTs = 0;
const HEALTH_CACHE_MS = 10 * 60 * 1000;

function pickAgent() {
  const now = Date.now();
  if (!_agentHealthCache || now - _agentHealthTs > HEALTH_CACHE_MS) {
    _agentHealthCache = checkAgentHealth();
    _agentHealthTs = now;
  }
  const available = _agentHealthCache.find(a => a.status === "ok");
  if (available) return available.name;
  console.log("[runner] WARNING No healthy agents, falling back to " + AGENT_PREFERENCE[0]);
  return AGENT_PREFERENCE[0];
}
// --- end agent health ---

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
  // Omit agentType so the server resolves it via the work-item override ->
  // project default -> workspace default -> "claude" hierarchy. The created
  // run echoes back the resolved agentType, which we use to pick the CLI.
  const run = await bobApi("POST", "/api/v1/runs", {
    workItemId: issue.identifier,
    workspaceId: BOB_WORKSPACE_ID,
    agentConfig: { title: issue.title, slug },
  });
  const id = run && run.id;
  const agentType = pickAgent();
  if (id) await bobApi("PATCH", "/api/v1/runs/" + id, { status: "running" });
  return { id: id || null, agentType };
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
  const resp = await fetch("https://tasks.gmac.io/graphql", {
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
          id identifier title description priority updatedAt
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

function unclaim(issueId) {
  const claimed = loadClaimed();
  delete claimed[issueId];
  saveClaimed(claimed);
}

// Build the [command, args] for a given agent type. codex keeps its exact
// prior invocation; claude and grok run headless against the working tree.
function agentCommand(agentType, prompt, logFile) {
  switch (agentType) {
    case "claude":
      return ["claude", [
        "-p", prompt,
        "--output-format", "text",
        "--dangerously-skip-permissions",
      ]];
    case "grok":
      // Grok Build headless mode (writes to stdout; we capture it ourselves).
      // Valid --output-format values are plain | json | streaming-json.
      return ["grok", ["-p", prompt, "--output-format", "plain"]];
    case "codex":
    default:
      return ["codex", [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m", "gpt-5.5",
        "-o", logFile,
        prompt,
      ]];
  }
}

async function runAgent(agentType, repoDir, prompt, logFile) {
  const [command, args] = agentCommand(agentType, prompt, logFile);
  console.log(`[runner] Spawning ${command} (agent: ${agentType})`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
      console.log(`[runner] Timeout, killing ${command}`);
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

// [pulse] playbook issues (GTM research etc.) are operating work, not code
// work: the issue body carries the full agent instructions, success is an API
// side effect (batch POSTed, run transitioned), and no commits are expected.
// Repo-optional lane: knowledge/ops tasks (e.g. "Refresh stale KB entries")
// on startups with no code repo. Runs the agent in a scratch dir with the
// issue description as instructions — no clone, no branch, no commit. Success
// is the agent printing "TASK_RESULT: ok". Mirrors processPlaybookIssue's
// no-git flow but with a generic operating prompt instead of the GTM one.
async function processRepoOptionalIssue(issue, slug, workDir) {
  const logFile = join(LOG_DIR, `${issue.identifier}-${Date.now()}.txt`);

  console.log(`[runner] Processing repo-optional issue ${issue.identifier}: ${issue.title}`);

  if (DRY_RUN) {
    console.log(`[runner] DRY RUN -- would run repo-optional agent here`);
    return "dry_run";
  }

  const { id: bobRunId, agentType } = await bobStartRun(issue, slug);

  try {
    await updateIssueState(issue.id, "started");
    await addIssueComment(issue.id, `🤖 Bob agent claiming this issue (repo-optional).\n\nRunner: ${agentType}`);
  } catch (e) {
    console.log(`[runner] Failed to update Linear: ${e.message}`);
  }

  const prompt = `You are an AI agent executing an operating task for the ${slug} startup in the BizPulse portfolio.

This is a knowledge/operations task with NO code repository. You are running in a scratch working directory (${workDir}); do NOT expect a checked-out repo, and do NOT create git branches or commits. The issue description below contains your full instructions. Environment you can rely on:
- PULSE_SERVICE_SECRET is set (Authorization: Bearer for BizPulse service endpoints)
- PULSE_API_KEY and PULSE_API_URL are set (the \`pulse\` CLI is installed and authenticates with them)

## Issue
**${issue.title}**

${issue.description || "No description provided."}

## Ground rules
- Do the work described using the pulse CLI / BizPulse API. Verify each call succeeded from its response before moving on.
- Do NOT modify or create any git repository.
- End your final message with exactly one line: "TASK_RESULT: ok" if every required step succeeded, or "TASK_RESULT: failed — <short reason>" otherwise.`;

  console.log(`[runner] Starting repo-optional agent...`);
  const result = await runAgent(agentType, workDir, prompt, logFile);
  console.log(`[runner] Agent exited with code ${result.exitCode}`);
  await bobPushLog(bobRunId, result.output);
  try { writeFileSync(logFile, result.output); } catch {}

  const succeeded = result.exitCode === 0 && /TASK_RESULT:\s*ok/i.test(result.output);
  const tail = result.output.length > 1500 ? result.output.slice(-1500) : result.output;

  if (succeeded) {
    try {
      await addIssueComment(issue.id, `✅ Bob agent completed this task.\n\n\`\`\`\n${tail}\n\`\`\``);
      await updateIssueState(issue.id, "completed");
    } catch {}
    await bobFinishRun(bobRunId, "completed", { exitCode: result.exitCode });
    return "completed";
  }

  try {
    await addIssueComment(issue.id, `⚠️ Bob agent did not report success on this task.\n\n\`\`\`\n${tail}\n\`\`\`\nLog: ${logFile}`);
    await updateIssueState(issue.id, "unstarted");
  } catch {}
  await bobFinishRun(bobRunId, "failed", { exitCode: result.exitCode, reason: "no_success_marker" });
  return "no_success";
}

async function processPlaybookIssue(issue, slug, repoDir) {
  const logFile = join(LOG_DIR, `${issue.identifier}-${Date.now()}.txt`);

  console.log(`[runner] Processing playbook issue ${issue.identifier}: ${issue.title}`);

  if (DRY_RUN) {
    console.log(`[runner] DRY RUN -- would run playbook agent here`);
    return "dry_run";
  }

  const { id: bobRunId, agentType } = await bobStartRun(issue, slug);

  try {
    await updateIssueState(issue.id, "started");
    await addIssueComment(issue.id, `🤖 Bob agent claiming this playbook issue.\n\nRunner: ${agentType}`);
  } catch (e) {
    console.log(`[runner] Failed to update Linear: ${e.message}`);
  }

  const prompt = `You are an AI agent executing a BizPulse playbook run for the ${slug} startup.

The issue description below contains your full instructions. Follow them exactly, including the curl/CLI commands. Environment you can rely on:
- PULSE_SERVICE_SECRET is set (for the GTM ingest endpoint Authorization header)
- PULSE_API_KEY and PULSE_API_URL are set (the \`pulse\` CLI is installed and authenticates with them)

## Issue
**${issue.title}**

${issue.description || "No description provided."}

## Ground rules
- This is operating work by default: do NOT modify repository files unless the issue instructions explicitly call for a repository deliverable. When they do, commit it on a branch named bob/${issue.identifier.toLowerCase()} and push that branch — never commit to master.
- Verify each API call succeeded from its response before moving on.
- End your final message with exactly one line: "PLAYBOOK_RESULT: ok" if every required step succeeded, or "PLAYBOOK_RESULT: failed — <short reason>" otherwise.`;

  console.log(`[runner] Starting playbook agent...`);
  const result = await runAgent(agentType, repoDir, prompt, logFile);
  console.log(`[runner] Agent exited with code ${result.exitCode}`);
  await bobPushLog(bobRunId, result.output);
  try { writeFileSync(logFile, result.output); } catch {}

  const succeeded = result.exitCode === 0 && /PLAYBOOK_RESULT:\s*ok/i.test(result.output);
  const tail = result.output.length > 1500 ? result.output.slice(-1500) : result.output;

  if (succeeded) {
    try {
      await addIssueComment(issue.id, `✅ Bob agent completed this playbook run.\n\n\`\`\`\n${tail}\n\`\`\``);
      await updateIssueState(issue.id, "completed");
    } catch {}
    await bobFinishRun(bobRunId, "completed", { exitCode: result.exitCode });
    return "completed";
  }

  try {
    await addIssueComment(issue.id, `⚠️ Bob agent did not report success on this playbook run.\n\n\`\`\`\n${tail}\n\`\`\`\nLog: ${logFile}`);
    await updateIssueState(issue.id, "unstarted");
  } catch {}
  await bobFinishRun(bobRunId, "failed", { exitCode: result.exitCode, reason: "no_success_marker" });
  return "no_success";
}

async function processIssue(issue, slug, repoDir) {
  if (issue.title.startsWith("[pulse]")) {
    return processPlaybookIssue(issue, slug, repoDir);
  }

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
  const { id: bobRunId, agentType } = await bobStartRun(issue, slug);

  // Mark as in-progress in Linear
  try {
    await updateIssueState(issue.id, "started");
    await addIssueComment(issue.id, `🤖 Bob agent claiming this issue.\n\nBranch: \`${branchName}\`\nRunner: ${agentType}\nRepo: ${repoDir}`);
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
  const result = await runAgent(agentType, repoDir, prompt, logFile);
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
      // Plain push: --force is both unnecessary (branches are per-issue) and
      // rejected by some repos (preflight-app blocks force pushes).
      execSync(`git push -u origin ${branchName}`, { cwd: repoDir, stdio: "pipe" });
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

// Dead-man heartbeat: the watchdog on the BizPulse side alerts when this
// goes silent past its threshold. Best-effort — never blocks the loop.
async function sendHeartbeat() {
  const secret = process.env.PULSE_SERVICE_SECRET;
  if (!secret) return;
  try {
    await fetch("https://bizpulse.cc/api/gtm/runner-heartbeat", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runner: "bob-task-runner" }),
    });
  } catch (e) {
    console.log(`[runner] heartbeat failed: ${e.message}`);
  }
}

async function runOnce() {
  console.log(`[runner] Scanning for work...`);
  void sendHeartbeat();
  await refreshRemoteConfig();

  const projects = effectiveProjects();
  const targetSlugs = STARTUP_FILTER ? [STARTUP_FILTER] : Object.keys(projects);

  // Collect all issues across all startups, then pick the highest priority globally
  const allCandidates = [];

  const defaultSlugs = new Set(Object.keys(DEFAULT_PROJECTS));
  for (const slug of targetSlugs) {
    const projectId = projects[slug];
    const repoOptional = isRepoOptional(slug);
    const repoDir = effectiveRepoDir(slug);
    if (
      !slugEligible(slug, {
        projectId,
        repoDir,
        cloneBenched: cloneBenched(slug, _cloneFailed, Date.now()),
        repoExists: repoDir ? existsSync(repoDir) : false,
        hasRemote: !!remoteEntry(slug),
        repoOptional,
      })
    ) {
      continue;
    }

    try {
      const issues = await getUnstartedIssues(projectId);
      for (const issue of issues) {
        if (!issueClaimable(slug, issue, { now: Date.now(), defaultSlugs })) continue;
        if (!isClaimed(issue.id)) {
          allCandidates.push({ issue, slug, repoDir, repoOptional });
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

  const { issue, slug, repoDir, repoOptional } = allCandidates[0];
  console.log(`[runner] Found: ${issue.identifier} (P${issue.priority}) - ${issue.title} [${slug}]`);
  console.log(`[runner] ${allCandidates.length} total unclaimed issues across ${targetSlugs.length} startups`);

  markClaimed(issue.id, slug);

  let workDir;
  if (repoOptional) {
    // Knowledge/ops task on a startup with no repo: run in a scratch dir, no
    // clone. This is what makes "Refresh stale KB entries" and other
    // targetSystem:"manual" audit issues claimable instead of failing on a
    // repo they never needed.
    workDir = scratchDirFor(slug);
    console.log(`[runner] ${issue.identifier} is repo-optional (${slug} has no repo) — scratch dir ${workDir}`);
  } else {
    if (!ensureRepoDir(slug)) {
      // Repo unavailable is an infrastructure failure, not a verdict on the
      // issue: UNCLAIM it so a future process (after the repo exists or the
      // config is fixed) can pick it up. The slug goes on _cloneFailed, so
      // this process won't thrash on it.
      console.log(`[runner] ${issue.identifier} unclaimed (repo unavailable for ${slug})`);
      unclaim(issue.id);
      return true;
    }
    workDir = repoDir;
  }

  try {
    let status;
    if (repoOptional) {
      // A [pulse]-titled playbook that happens to land on a repo-optional slug
      // still runs through the playbook lane (also no-git); everything else is
      // a generic operating task.
      status = issue.title.startsWith("[pulse]")
        ? await processPlaybookIssue(issue, slug, workDir)
        : await processRepoOptionalIssue(issue, slug, workDir);
    } else {
      status = await processIssue(issue, slug, workDir);
    }
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
  console.log("[runner] Checking agent health...");
  checkAgentHealth();

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

// Exported for regression tests. Only auto-run the poller when invoked
// directly (node task-runner.js), so requiring the module in a test does not
// start the 2-minute scan loop.
module.exports = { slugEligible, issueClaimable, cloneBenched };

if (require.main === module) {
  main().catch(e => {
    console.error(`[runner] Fatal: ${e.message}`);
    process.exit(1);
  });
}
