/**
 * The reaper deletes stale agent worktrees. Until 2026-08-30 it deleted the
 * directory without touching the processes running inside it, and its safety
 * comment ("an active dispatch's worktree has a recent mtime") had the failure
 * backwards: a HUNG dispatch stops touching files, so it looks stale, so the
 * reaper pulled the worktree out from under a live process tree.
 *
 * One dispatch leaked 73 pnpm processes that way. They reparented to init,
 * span against a deleted cwd for four days, and took hetzner-bob to a load
 * average of 90 on 8 cores, which broke CI on that runner.
 *
 * These tests drive the real script against real directories and real
 * processes — the bug was entirely in what the script did to the OS, so a
 * mocked version would have passed while the host burned.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REAP = join(dirname(fileURLToPath(import.meta.url)), "bob-worktree-reap");

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "reap-"));
}

/** Age a directory past the reaper's threshold. */
function ageDir(path, days) {
  const when = new Date(Date.now() - days * 86_400_000);
  utimesSync(path, when, when);
}

function runReap(root, days = 3) {
  return execFileSync(REAP, [String(days)], {
    encoding: "utf8",
    env: { ...process.env, BOB_WORKTREE_ROOT: root },
  });
}

function sleeper(cwd) {
  const child = spawn("sleep", ["120"], { cwd, detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("removes a stale worktree", () => {
  const root = makeRoot();
  const wt = join(root, "proj", "bob-stale");
  mkdirSync(wt, { recursive: true });
  ageDir(wt, 5);

  runReap(root);

  assert.equal(existsSync(wt), false);
  rmSync(root, { recursive: true, force: true });
});

test("leaves a fresh worktree alone", () => {
  const root = makeRoot();
  const wt = join(root, "proj", "bob-fresh");
  mkdirSync(wt, { recursive: true });

  runReap(root);

  assert.equal(existsSync(wt), true);
  rmSync(root, { recursive: true, force: true });
});

test("kills processes inside a worktree before deleting it", async () => {
  // The regression. A hung dispatch has a stale mtime, so it IS reaped — the
  // script must take its process tree down with it rather than orphan it.
  const root = makeRoot();
  const wt = join(root, "proj", "bob-hung");
  mkdirSync(wt, { recursive: true });
  const child = sleeper(wt);
  await new Promise((r) => setTimeout(r, 300));
  ageDir(wt, 5);

  runReap(root);
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(alive(child.pid), false, "process inside a reaped worktree must be killed");
  assert.equal(existsSync(wt), false);
  rmSync(root, { recursive: true, force: true });
});

test("does not kill a process inside a worktree it is keeping", async () => {
  // The other half: reaping must never touch a running dispatch's processes.
  const root = makeRoot();
  const wt = join(root, "proj", "bob-active");
  mkdirSync(wt, { recursive: true });
  const child = sleeper(wt);
  await new Promise((r) => setTimeout(r, 300));

  runReap(root);
  await new Promise((r) => setTimeout(r, 300));

  assert.equal(alive(child.pid), true, "an active dispatch must survive the reaper");
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  rmSync(root, { recursive: true, force: true });
});
