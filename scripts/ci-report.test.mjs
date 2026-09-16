import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReport, saveReport, loadReport, sendReport, settledReport } from "./ci-report.mjs";

const env = {
  CI_CHECK_SHA: "a".repeat(40), CI_CHECK_RUN_ID: "19170", CI_CHECK_ATTEMPT: "1",
  GITHUB_REPOSITORY: "gmackie/bob", GITHUB_SERVER_URL: "https://git.forgegraf.com",
  GITHUB_RUN_NUMBER: "1166", CI_REPORT_BRANCH: 'fix/"quoted"',
  CI_JOB_STATUS: "success", CI_TYPECHECK: "success", CI_LINT: "success", CI_TEST: "success",
};
const summary = { version: 2, phases: [{ phase: "test", failures: [], counts: { passed: 3, failed: 0 } }] };

test("report is JSON-safe, preserves native identity and exact check summary", async () => {
  const report = buildReport(env, summary);
  assert.equal(report.runUrl, "https://git.forgegraf.com/gmackie/bob/actions/runs/1166");
  assert.equal(report.runId, "19170");
  assert.equal(report.status, "success");
  assert.deepEqual(report.tests, summary);
  const dir = await mkdtemp(join(tmpdir(), "bob-ci-report-"));
  try {
    const path = join(dir, "nested", "report.json");
    await saveReport(path, report);
    const restored = await loadReport(path, env);
    assert.deepEqual(restored, report);
    assert.equal(JSON.parse(await readFile(path, "utf8")).branch, env.CI_REPORT_BRANCH);
    await assert.rejects(loadReport(path, { ...env, CI_CHECK_SHA: "b".repeat(40) }), /provenance/);
    await assert.rejects(loadReport(path, { ...env, CI_CHECK_RUN_ID: "other" }), /provenance/);
    await assert.rejects(loadReport(path, { ...env, CI_CHECK_ATTEMPT: "2" }), /provenance/);
    await assert.rejects(loadReport(path, { ...env, GITHUB_REPOSITORY: "someone/else" }), /provenance/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("independent publisher respects both prerequisite jobs and never upgrades a failure", () => {
  const report = buildReport(env);
  assert.equal(settledReport(report, "success", "success").status, "success");
  for (const result of ["failure", "skipped", undefined]) {
    assert.equal(settledReport(report, result, "success").status, "failure");
    assert.equal(settledReport(report, "success", result).status, "failure");
  }
  assert.equal(settledReport(report, "cancelled", "success").status, "cancelled");
  assert.equal(settledReport({ ...report, status: "failure" }, "success", "success").status, "failure");
});

test("skipped, failed and missing checks cannot produce a successful report", () => {
  for (const outcome of ["failure", "skipped", "cancelled", ""]) {
    assert.equal(buildReport({ ...env, CI_TEST: outcome }, summary).status, "failure");
  }
  assert.equal(buildReport({ ...env, CI_JOB_STATUS: "failure" }, summary).status, "failure");
  assert.equal(buildReport({ ...env, CI_JOB_STATUS: "cancelled" }, summary).status, "cancelled");
  assert.throws(() => buildReport({ ...env, CI_CHECK_SHA: "" }, summary), /provenance/);
});

async function server(t, handler) {
  const s = createServer(handler);
  await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${s.address().port}/report`;
}

test("transient failure retries the exact preserved payload and accepts the acknowledgement", async t => {
  const bodies = [];
  const endpoint = await server(t, async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    bodies.push(body);
    assert.equal(req.headers.authorization, "Bearer test-token");
    res.writeHead(bodies.length === 1 ? 503 : 200, { "content-type": "application/json" });
    res.end(bodies.length === 1 ? "{}" : JSON.stringify({ ok: true, buildId: "build", status: "passed" }));
  });
  const report = buildReport(env, summary);
  const response = await sendReport(report, { token: "test-token", endpoint, retryDelayMs: 1 });
  assert.equal(response.buildId, "build");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0]), report);
});

test("permanent auth failure is visible, not retried, and response secrets are not logged", async t => {
  let calls = 0;
  const endpoint = await server(t, (_, res) => { calls++; res.writeHead(401); res.end("sensitive-server-response"); });
  await assert.rejects(sendReport(buildReport(env), { token: "test-token", endpoint, retryDelayMs: 1 }), error => {
    assert.match(error.message, /401/); assert.doesNotMatch(error.message, /sensitive/); return true;
  });
  assert.equal(calls, 1);
});

test("redirects never forward the reporting credential", async t => {
  let leaked = false;
  const target = await server(t, (_, res) => { leaked = true; res.end("{}"); });
  const endpoint = await server(t, (_, res) => { res.writeHead(302, { location: target }); res.end(); });
  await assert.rejects(sendReport(buildReport(env), { token: "test-token", endpoint }), /302/);
  assert.equal(leaked, false);
});

test("a successful HTTP response must acknowledge a stored CI report", async t => {
  const endpoint = await server(t, (_, res) => { res.writeHead(200); res.end('{"ok":false}'); });
  await assert.rejects(sendReport(buildReport(env), { token: "test-token", endpoint }), /acknowledgement/);
});

test("hanging response body is bounded and retry count is finite", async t => {
  let calls = 0;
  const endpoint = await server(t, (_, res) => { calls++; res.writeHead(200); res.write('{"ok":'); });
  const start = Date.now();
  await assert.rejects(sendReport(buildReport(env), {
    token: "test-token", endpoint, timeoutMs: 150, maxAttempts: 2, retryDelayMs: 1,
  }), /attempts/);
  assert.equal(calls, 2);
  assert.ok(Date.now() - start < 5000);
});

test("missing credential cannot send a request", async t => {
  let calls = 0;
  const endpoint = await server(t, (_, res) => { calls++; res.end("{}"); });
  await assert.rejects(sendReport(buildReport(env), { token: "", endpoint }), /FG_CI_TOKEN/);
  assert.equal(calls, 0);
});
