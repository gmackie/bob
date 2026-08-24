#!/usr/bin/env node
/**
 * bob-check — structured typecheck/lint/test/build for agent worktrees.
 *
 * Agents used to run ad-hoc commands whose progress the UI could only show as
 * a spinner. This wrapper (dropped into each worktree's PATH by the runner)
 * auto-detects the repo's commands, runs them, prints a human summary for the
 * agent, and appends NDJSON events to .bob/check-events.ndjson — which the
 * runner tails into `check` session events for the cockpit's per-phase bars.
 *
 * Zero dependencies; plain Node. Usage: bob-check [phase ...]
 * (default: every detected phase in order typecheck, lint, test, build)
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const EVENTS = join(cwd, ".bob", "check-events.ndjson");
const ORDER = ["typecheck", "lint", "test", "build"];

function emit(obj) {
  const line = JSON.stringify({ ...obj, at: new Date().toISOString() });
  try {
    mkdirSync(join(cwd, ".bob"), { recursive: true });
    appendFileSync(EVENTS, line + "\n");
  } catch {
    /* events are best-effort; the run itself still matters */
  }
}

function detect() {
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    return { pm: null, phases: {} };
  }
  const pm = existsSync(join(cwd, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(cwd, "yarn.lock"))
      ? "yarn"
      : "npm";
  const scripts = pkg.scripts ?? {};
  const phases = {};
  for (const name of ORDER) {
    if (scripts[name]) phases[name] = [pm, "run", name];
    else if (name === "typecheck" && scripts["type-check"]) phases[name] = [pm, "run", "type-check"];
  }
  return { pm, phases };
}

/** Best-effort test-count parsing (vitest / jest / node:test shapes). */
function parseCounts(text) {
  const m =
    /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/.exec(text) ??
    /Tests:\s+(?:(\d+)\s+failed,\s*)?(\d+)\s+passed,\s*(?:\d+\s+skipped,\s*)?(?:(\d+)\s+total)?/.exec(text);
  if (!m) return null;
  return { failed: Number(m[1] ?? 0), passed: Number(m[2] ?? 0), total: Number(m[4] ?? m[3] ?? 0) || undefined };
}

/** Pull the most informative failure lines for the event payload. */
function failureLines(text) {
  return text
    .split("\n")
    .filter((l) => /FAIL|✗|✕|error TS\d+|Error:|assert/i.test(l))
    .slice(0, 8)
    .map((l) => l.trim().slice(0, 200));
}

async function runPhase(name, cmd) {
  emit({ phase: name, status: "running", command: cmd.join(" ") });
  process.stdout.write(`\n▶ bob-check ${name}: ${cmd.join(" ")}\n`);
  const started = Date.now();
  let out = "";
  const code = await new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const collect = (d) => {
      const s = d.toString();
      out += s;
      if (out.length > 400_000) out = out.slice(-400_000);
      process.stdout.write(s);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => {
      out += `\n${err.message}`;
      resolve(127);
    });
    child.on("close", (c) => resolve(c ?? 1));
  });
  const durationMs = Date.now() - started;
  const counts = name === "test" ? parseCounts(out) : null;
  const status = code === 0 ? "passed" : "failed";
  emit({
    phase: name,
    status,
    exitCode: code,
    durationMs,
    ...(counts ?? {}),
    ...(status === "failed" ? { failures: failureLines(out) } : {}),
  });
  process.stdout.write(`${status === "passed" ? "✓" : "✗"} ${name} ${status} in ${(durationMs / 1000).toFixed(1)}s\n`);
  return status === "passed";
}

const { phases } = detect();
const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const toRun = (requested.length ? requested : ORDER).filter((p) => phases[p]);

if (!toRun.length) {
  process.stdout.write("bob-check: no typecheck/lint/test/build scripts detected in package.json\n");
  emit({ phase: "all", status: "skipped", reason: "no scripts detected" });
  process.exit(0);
}

emit({ phase: "all", status: "running", phases: toRun });
let ok = true;
for (const name of toRun) {
  // eslint-disable-next-line no-await-in-loop
  ok = (await runPhase(name, phases[name])) && ok;
}
emit({ phase: "all", status: ok ? "passed" : "failed" });
process.stdout.write(`\nbob-check: ${ok ? "ALL GREEN" : "FAILURES ABOVE"}\n`);
process.exit(ok ? 0 : 1);
