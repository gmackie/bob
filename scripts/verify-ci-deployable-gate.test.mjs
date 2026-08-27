import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEPLOYED_APPS,
  decide,
  recordedTasks,
} from "./ci-deployable-gate.mjs";

/**
 * This gate decides whether production deploys happen, so its two failure
 * modes are asymmetric: wrongly allowing a deploy ships broken code, wrongly
 * blocking one is the status quo it exists to fix. Every ambiguous case here
 * must resolve to "blocked".
 */

const CLOSURE = new Set(["@bob/blder", "@bob/api", "@gmacko/ooda", "@gmacko/ooda-edge"]);
const ok = (pkg, task) => ({ package: pkg, task, execution: { exitCode: 0 } });
const bad = (pkg, task) => ({ package: pkg, task, execution: { exitCode: 1 } });

test("a clean run deploys", () => {
  const r = decide([ok("@bob/api", "lint"), ok("@bob/mobile", "lint")], CLOSURE);
  assert.equal(r.deployable, true);
  assert.deepEqual(r.blocking, []);
});

// The case this whole gate exists for: on 2026-08-23 a Metro shim outside
// mobile's tsconfig stopped the web worker from shipping for ~5 hours.
test("a failure outside the closure does not block the deploy", () => {
  const r = decide([bad("@bob/mobile", "lint"), ok("@bob/api", "lint")], CLOSURE);
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
    [bad("@bob/mobile", "lint"), bad("@bob/desktop", "test"), bad("@gmacko/ooda", "typecheck")],
    CLOSURE,
  );
  assert.equal(r.deployable, false);
  assert.deepEqual(r.blocking, ["@gmacko/ooda#typecheck"]);
  assert.equal(r.nonBlocking.length, 2);
});

// A task with no execution record is unknown, not passing.
test("a missing exit code counts as passing only when explicitly zero", () => {
  assert.equal(decide([{ package: "@bob/api", task: "lint" }], CLOSURE).deployable, true);
  assert.equal(
    decide([{ package: "@bob/api", task: "lint", execution: {} }], CLOSURE).deployable,
    true,
  );
  assert.equal(
    decide([{ package: "@bob/api", task: "lint", execution: { exitCode: 137 } }], CLOSURE)
      .deployable,
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
    // Unreadable summaries are outside any closure, so they do not block on
    // their own — but they must never read as a pass.
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
