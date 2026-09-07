import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEPLOYED_APPS, decide, recordedTasks } from "./ci-deployable-gate.mjs";

/**
 * This gate decides whether production deploys happen, so its two failure
 * modes are asymmetric: wrongly allowing a deploy ships broken code, wrongly
 * blocking one is the status quo it exists to fix. Every ambiguous case here
 * must resolve to "blocked".
 */

const CLOSURE = new Set([
  "@bob/blder",
  "@bob/api",
  "@gmacko/ooda",
  "@gmacko/ooda-edge",
]);
const ok = (pkg, task) => ({ package: pkg, task, execution: { exitCode: 0 } });
const bad = (pkg, task) => ({ package: pkg, task, execution: { exitCode: 1 } });

test("a clean run deploys", () => {
  const r = decide(
    [ok("@bob/api", "lint"), ok("@bob/mobile", "lint")],
    CLOSURE,
  );
  assert.equal(r.deployable, true);
  assert.deepEqual(r.blocking, []);
});

// The case this whole gate exists for: on 2026-08-23 a Metro shim outside
// mobile's tsconfig stopped the web worker from shipping for ~5 hours.
test("a failure outside the closure does not block the deploy", () => {
  const r = decide(
    [bad("@bob/mobile", "lint"), ok("@bob/api", "lint")],
    CLOSURE,
  );
  assert.equal(r.deployable, true);
  assert.deepEqual(r.nonBlocking, ["@bob/mobile#lint"]);
  assert.deepEqual(r.blocking, []);
});

test("a failure inside the closure blocks the deploy", () => {
  const r = decide([bad("@bob/api", "lint")], CLOSURE);
  assert.equal(r.deployable, false);
  assert.deepEqual(r.blocking, ["@bob/api#lint"]);
});

test("one blocking failure is enough, even among many harmless ones", () => {
  const r = decide(
    [
      bad("@bob/mobile", "lint"),
      bad("@bob/desktop", "test"),
      bad("@gmacko/ooda", "typecheck"),
    ],
    CLOSURE,
  );
  assert.equal(r.deployable, false);
  assert.deepEqual(r.blocking, ["@gmacko/ooda#typecheck"]);
  assert.equal(r.nonBlocking.length, 2);
});

// A task with no execution record is unknown, not passing.
test("a missing exit code counts as passing only when explicitly zero", () => {
  assert.equal(
    decide([{ package: "@bob/api", task: "lint" }], CLOSURE).deployable,
    false,
  );
  assert.equal(
    decide([{ package: "@bob/api", task: "lint", execution: {} }], CLOSURE)
      .deployable,
    false,
  );
  assert.equal(
    decide(
      [{ package: "@bob/api", task: "lint", execution: { exitCode: 137 } }],
      CLOSURE,
    ).deployable,
    false,
    "an OOM kill (137) must block",
  );
});

test("the deployed apps are themselves inside the closure they gate on", () => {
  for (const app of DEPLOYED_APPS) {
    assert.equal(
      decide([bad(app, "typecheck")], new Set(DEPLOYED_APPS)).deployable,
      false,
      `${app} failing must block its own deploy`,
    );
  }
});

test("an unreadable summary blocks rather than being skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-"));
  try {
    writeFileSync(join(dir, "truncated.json"), "{ not json");
    const tasks = recordedTasks(dir);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].execution.exitCode, 1);
    // Unreadable evidence blocks globally, even when its package is unknown.
    assert.notEqual(tasks[0].execution.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no summaries at all yields no tasks, which the CLI treats as blocking", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-empty-"));
  try {
    assert.deepEqual(recordedTasks(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(recordedTasks("/nonexistent/path/for/gate/test"), []);
});

test("unreadable evidence blocks even outside the deploy closure", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-corrupt-"));
  try {
    writeFileSync(join(dir, "bad.json"), "{");
    assert.equal(decide(recordedTasks(dir), CLOSURE).deployable, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("complete phase evidence must cover every declared task at the current SHA/run", async () => {
  const { decideEvidence } = await import("./ci-deployable-gate.mjs");
  const expected = ["@bob/api#lint", "@bob/api#test", "@bob/api#typecheck"];
  const provenance = { sha: "abc", runId: "123", attempt: "1" };
  const evidence = ["lint", "test", "typecheck"].map((phase) => ({
    ...provenance,
    phase,
    exitCode: 0,
    tasks: [ok("@bob/api", phase)],
  }));
  assert.equal(
    decideEvidence(evidence, CLOSURE, expected, provenance).deployable,
    true,
  );
  for (const broken of [
    evidence.slice(1),
    evidence.map((e) => ({ ...e, sha: "old" })),
    evidence.map((e) => ({ ...e, tasks: [] })),
    evidence.map((e) => ({ ...e, runId: "122" })),
    evidence.map((e) => ({ ...e, exitCode: null })),
    evidence.map((e) => ({ ...e, exitCode: 137 })),
  ]) {
    assert.equal(
      decideEvidence(broken, CLOSURE, expected, provenance).deployable,
      false,
    );
  }
  const cached = evidence.map((e) => ({
    ...e,
    tasks: [
      {
        package: "@bob/api",
        task: e.phase,
        hash: "abc123",
        cache: { status: "HIT" },
      },
    ],
  }));
  assert.equal(
    decideEvidence(cached, CLOSURE, expected, provenance).deployable,
    true,
  );
  assert.equal(
    decideEvidence(
      [...evidence, { ...evidence[0], tasks: [bad("@bob/api", "lint")] }],
      CLOSURE,
      expected,
      provenance,
    ).deployable,
    false,
  );
});

test("phase command failure without a recorded task failure blocks deployment", async () => {
  const { decideEvidence } = await import("./ci-deployable-gate.mjs");
  const p = { sha: "a", runId: "1", attempt: "1" };
  const records = ["typecheck", "lint", "test"].map((phase) => ({
    ...p,
    phase,
    exitCode: 0,
    tasks: [ok("@bob/api", phase)],
  }));
  records[0].exitCode = 1;
  assert.equal(decideEvidence(records, CLOSURE, [], p).deployable, false);
  records[0].tasks.push(bad("@bob/mobile", "typecheck"));
  assert.equal(decideEvidence(records, CLOSURE, [], p).deployable, true);
  assert.equal(
    decideEvidence(records, CLOSURE, ["@bob/api#build"], p).deployable,
    false,
  );
});

test("phase wrapper records only fresh summaries with matching checkout provenance", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdirSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const wrapper = fileURLToPath(
    new URL("./ci-check-phase.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "gate-wrapper-"));
  try {
    mkdirSync(join(dir, ".turbo", "runs"), { recursive: true });
    writeFileSync(
      join(dir, ".turbo", "runs", "stale.json"),
      JSON.stringify({
        scm: { sha: "current" },
        tasks: [ok("@bob/api", "lint")],
      }),
    );
    writeFileSync(
      join(dir, "fresh.mjs"),
      `import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('.turbo/runs',{recursive:true}); writeFileSync('.turbo/runs/fresh.json',JSON.stringify({scm:{sha:'current'},tasks:[{package:'@bob/api',task:'lint',execution:{exitCode:0}}]}));`,
    );
    const env = {
      ...process.env,
      CI_CHECK_SHA: "current",
      CI_CHECK_RUN_ID: "123",
      CI_CHECK_ATTEMPT: "1",
    };
    let r = spawnSync(
      process.execPath,
      [wrapper, "lint", "--", process.execPath, "fresh.mjs"],
      { cwd: dir, env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    let e = JSON.parse(
      readFileSync(join(dir, ".turbo", "ci-evidence", "lint.json"), "utf8"),
    );
    assert.equal(e.evidenceError, false);
    assert.equal(e.tasks.length, 1);
    assert.equal(e.runId, "123");
    // A command with no summary cannot borrow the prior invocation's success.
    r = spawnSync(
      process.execPath,
      [wrapper, "lint", "--", process.execPath, "--version"],
      { cwd: dir, env, encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr);
    e = JSON.parse(
      readFileSync(join(dir, ".turbo", "ci-evidence", "lint.json"), "utf8"),
    );
    assert.equal(e.evidenceError, true);
    assert.equal(
      e.exitCode,
      0,
      "receipt must preserve the successful command result",
    );

    writeFileSync(
      join(dir, "wrong-sha.mjs"),
      `import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('.turbo/runs',{recursive:true}); writeFileSync('.turbo/runs/fresh.json',JSON.stringify({scm:{sha:'other'},tasks:[{package:'@bob/api',task:'lint',execution:{exitCode:0}}]}));`,
    );
    r = spawnSync(
      process.execPath,
      [wrapper, "lint", "--", process.execPath, "wrong-sha.mjs"],
      { cwd: dir, env, encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr);
    e = JSON.parse(
      readFileSync(join(dir, ".turbo", "ci-evidence", "lint.json"), "utf8"),
    );
    assert.equal(e.evidenceError, true);
    assert.equal(e.exitCode, 0);

    writeFileSync(join(dir, "nonzero.mjs"), "process.exit(7);\n");
    r = spawnSync(
      process.execPath,
      [wrapper, "lint", "--", process.execPath, "nonzero.mjs"],
      { cwd: dir, env, encoding: "utf8" },
    );
    assert.equal(
      r.status,
      7,
      "an original nonzero command status must be preserved",
    );
    e = JSON.parse(
      readFileSync(join(dir, ".turbo", "ci-evidence", "lint.json"), "utf8"),
    );
    assert.equal(e.exitCode, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
