#!/usr/bin/env node
// Subscription-powered PR review + auto-merge reaper.
//
// Runs on hetzner-bob (as bob). Reviews open PRs that Bob opened with a
// subscription agent (`claude -p` — NO Anthropic API credits) and merges the
// ones that clear all three gates: mergeable (no conflict) AND CI green AND an
// approving AI review. This replaces the Worker's ANTHROPIC_API_KEY review pass
// (credit-blocked). Idempotent per (repo#num@headSha) via a state file, so a
// commit is reviewed once; a new push re-reviews.
//
// Env:
//   FORGEJO_TOKEN   (required)  gmackie token for the Forgejo API
//   REAPER_DRY_RUN  ("true"|"false", default "true")  review+post verdict, never merge
//   REAPER_MAX      (default 8)  max PRs to process per run (paces review time + merges)
//   REAPER_STATE    (default ~/.bob-pr-reaper-seen.json)

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://git.forgegraf.com";
const OWNER = "gmackie";
const TOKEN = process.env.FORGEJO_TOKEN;
const DRY_RUN = String(process.env.REAPER_DRY_RUN ?? "true") !== "false";
const MAX = Number(process.env.REAPER_MAX ?? 8);
const MAX_DIFF = 14000;
const STATE = process.env.REAPER_STATE ?? join(homedir(), ".bob-pr-reaper-seen.json");

if (!TOKEN) { console.error("FORGEJO_TOKEN required"); process.exit(1); }

const H = { Authorization: `token ${TOKEN}`, "Content-Type": "application/json" };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, { headers: H, ...opts });
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function rawDiff(owner, repo, num) {
  const res = await fetch(`${BASE}/api/v1/repos/${owner}/${repo}/pulls/${num}.diff`, { headers: H });
  return res.ok ? await res.text() : "";
}

function loadSeen() { try { return new Set(JSON.parse(readFileSync(STATE, "utf8"))); } catch { return new Set(); } }
function saveSeen(set) { try { writeFileSync(STATE, JSON.stringify([...set].slice(-5000))); } catch (e) { console.error("state write failed:", e.message); } }

function claudeReview(diff) {
  const prompt =
    "You are a rigorous senior engineer reviewing a pull request opened by an AI agent. " +
    "Judge whether the change is correct, self-consistent, and complete for its stated intent. " +
    "Be skeptical: reject if it references call sites it doesn't update, is half-finished, or could break compilation/tests. " +
    "Reply with ONE line of JSON ONLY, no prose: {\"approve\": true|false, \"summary\": \"<=200 chars\"}. " +
    "Unified diff follows:\n\n" + diff.slice(0, MAX_DIFF);
  return new Promise((resolve) => {
    execFile("claude", ["-p", prompt], { timeout: 150000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ approve: false, summary: `review error: ${err.message.slice(0, 120)}`, errored: true });
      const m = String(stdout).match(/\{[\s\S]*"approve"[\s\S]*\}/);
      if (!m) return resolve({ approve: false, summary: "unparseable review; not approving", errored: true });
      try { const v = JSON.parse(m[0]); resolve({ approve: !!v.approve, summary: String(v.summary ?? "").slice(0, 400) }); }
      catch { resolve({ approve: false, summary: "unparseable review JSON; not approving", errored: true }); }
    });
  });
}

async function listOpenPrs() {
  // Enumerate the owner's repos, then open PRs per repo.
  const prs = [];
  for (let page = 1; page <= 20; page++) {
    const repos = await api(`/orgs/${OWNER}/repos?limit=50&page=${page}`).catch(() => null)
      ?? await api(`/users/${OWNER}/repos?limit=50&page=${page}`).catch(() => []);
    if (!repos || repos.length === 0) break;
    for (const r of repos) {
      const open = await api(`/repos/${OWNER}/${r.name}/pulls?state=open&limit=50`).catch(() => []);
      for (const pr of open) prs.push({ repo: r.name, num: pr.number });
    }
    if (repos.length < 50) break;
  }
  return prs;
}

async function main() {
  console.log(`[pr-reaper] start dry_run=${DRY_RUN} max=${MAX}`);
  const seen = loadSeen();
  const all = await listOpenPrs();
  console.log(`[pr-reaper] ${all.length} open PRs across ${OWNER}`);
  let reviewed = 0, merged = 0, skipped = 0;
  for (const { repo, num } of all) {
    if (reviewed >= MAX) break;
    let pr;
    try { pr = await api(`/repos/${OWNER}/${repo}/pulls/${num}`); } catch { skipped++; continue; }
    const sha = pr?.head?.sha;
    const key = `${repo}#${num}@${sha}`;
    if (!sha || seen.has(key)) { skipped++; continue; }
    // Gate 1: mergeable (no conflict)
    if (pr.mergeable !== true) { seen.add(key); skipped++; continue; }
    // Gate 2: CI green
    let ci;
    try { ci = await api(`/repos/${OWNER}/${repo}/commits/${sha}/status`); } catch { skipped++; continue; }
    if ((ci?.state) !== "success") { seen.add(key); skipped++; continue; }
    // Gate 3: AI review (subscription)
    const diff = await rawDiff(OWNER, repo, num);
    if (!diff) { skipped++; continue; }
    const verdict = await claudeReview(diff);
    reviewed++;
    if (verdict.errored) { console.log(`[pr-reaper] ${repo}#${num} REVIEW-ERROR ${verdict.summary}`); continue; }
    // Record the verdict as an issue comment. Forgejo blocks formally reviewing
    // your OWN PR (422), and Bob opens these under the same account, so a
    // comment is the durable audit trail instead of a review event.
    try {
      await api(`/repos/${OWNER}/${repo}/issues/${num}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `🤖 Bob subscription review — **${verdict.approve ? "APPROVE" : "REQUEST CHANGES"}**: ${verdict.summary}` }),
      });
    } catch (e) { console.log(`[pr-reaper] ${repo}#${num} comment-post-failed: ${e.message.slice(0, 80)}`); }
    seen.add(key);
    if (verdict.approve && !DRY_RUN) {
      try {
        await api(`/repos/${OWNER}/${repo}/pulls/${num}/merge`, { method: "POST", body: JSON.stringify({ Do: "merge", delete_branch_after_merge: true }) });
        merged++;
        console.log(`[pr-reaper] ${repo}#${num} MERGED — ${verdict.summary}`);
      } catch (e) { console.log(`[pr-reaper] ${repo}#${num} MERGE-FAILED: ${e.message.slice(0, 120)}`); }
    } else {
      console.log(`[pr-reaper] ${repo}#${num} ${verdict.approve ? "APPROVE" : "reject"}${DRY_RUN ? " (dry-run)" : ""} — ${verdict.summary}`);
    }
  }
  saveSeen(seen);
  console.log(`[pr-reaper] done reviewed=${reviewed} merged=${merged} skipped=${skipped}`);
}
main().catch((e) => { console.error("[pr-reaper] fatal:", e); process.exit(1); });
