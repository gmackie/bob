import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { kanbangerClient } from '../runtime/kanbanger.mjs';
import { runWorker } from '../runtime/worker.mjs';
import { fakeKanbanger, projectId, issueUuid, states } from './fixtures/fake-kanbanger.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'BOB', projectId };
const context = { workspaceId: 'workspace', actorId: 'actor', targets: [target], issueProjects: [project] };
const request = planId => ({ contractVersion: '1', requestId: 'request-1', attemptId: 'attempt-1', itemId: 'item-1', planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check result'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-54' }, executionProfileId: 'pistache' });
const admission = r => ({ contractVersion: '1', requestId: r.requestId, executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, target: r.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-1' } });

async function seed(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-worker-')), database = join(dir, 'store.sqlite');
  const c = new ExecutionCoordinator({ database, context });
  const plan = c.call('CreatePlan', { contractVersion: '1', commandId: 'create', plan: { items: [{ itemId: 'item-1', issue: { ...project, issueId: 'BOB-37', identifier: 'BOB-37' }, issueSnapshotRef: 'snapshot', target, completionTarget: 'execution' }], dependencies: [], concurrencyLimit: 1 } }, { idempotencyKey: 'create' });
  c.call('ControlPlan', { contractVersion: '1', commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' }, { idempotencyKey: 'start' });
  const body = request(plan.resourceId);
  c.call('RequestExecution', body, { idempotencyKey: body.requestId });
  c.close();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, database, body };
}

test('worker loop dispatches, drains the outbox and stops on abort without leaving a lease', async t => {
  const { database, body } = await seed(t);
  const fake = await fakeKanbanger(); t.after(() => fake.close());
  const coordinator = new ExecutionCoordinator({ database, context }); t.after(() => coordinator.close());
  const controller = new AbortController(), lines = [];
  let submissions = 0;
  const port = { requireCapabilities: async () => {}, find: async () => null, submit: async r => { submissions++; return admission(r); } };
  const log = line => {
    lines.push(line);
    if (line.step === 'drain' && line.delivered) controller.abort();
  };
  await runWorker({ coordinator, port, kanbanger: kanbangerClient({ endpoint: fake.endpoint, token: fake.token, integrationId: 'kanbanger' }), intervalMs: 20, signal: controller.signal, log });
  assert.equal(submissions, 1);
  assert.deepEqual(lines.map(line => line.step).slice(0, 3), ['start', 'dispatch', 'drain']);
  assert.equal(lines[1].outcome, 'dispatched'); assert.equal(lines[1].attemptId, body.attemptId);
  assert.equal(lines.at(-1).step, 'stop');
  assert.equal(fake.issues.get(issueUuid).stateId, states[1].id);
  const attempt = coordinator.attempt(body.attemptId);
  assert.equal(attempt.state, 'admitted'); assert.equal(attempt.lease_owner, null);
  assert.equal(coordinator.db.prepare("SELECT status FROM coordination_issue_effect").get().status, 'delivered');
  assert(!JSON.stringify(lines).includes(fake.token));
});

test('bob-coordinate-worker logs JSON per step and exits cleanly on SIGTERM', async t => {
  const { dir, database, body } = await seed(t);
  const fake = await fakeKanbanger(); t.after(() => fake.close());
  const capabilities = { contractVersion: '1', operations: ['SubmitExecution', 'FindExecution'], executionProfiles: ['pistache'], validationProfiles: [], eventResume: true, durableExecutionAdmission: true };
  const environment = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/capabilities/query')) return res.end(JSON.stringify(capabilities));
    if (req.url.endsWith('/requests/query')) { res.statusCode = 404; return res.end(JSON.stringify({ type: 'about:blank', title: 'Not found', status: 404, code: 'NotFound', retryable: false })); }
    res.end(JSON.stringify(admission(JSON.parse(raw))));
  });
  environment.listen(0, '127.0.0.1'); await once(environment, 'listening');
  t.after(async () => { const closed = once(environment, 'close'); environment.close(); environment.closeAllConnections(); await closed; });
  const files = { context: join(dir, 'policy.json'), bindings: join(dir, 'bindings.json'), kanbanger: join(dir, 'kanbanger.json') };
  writeFileSync(files.context, JSON.stringify(context));
  writeFileSync(files.bindings, JSON.stringify([{ target, baseUrl: `http://127.0.0.1:${environment.address().port}`, authToken: 'environment-secret-token' }]));
  writeFileSync(files.kanbanger, JSON.stringify({ endpoint: fake.endpoint, tokenEnv: 'BOB_TEST_KANBANGER_TOKEN', integrationId: 'kanbanger' }));
  const child = spawn(process.execPath, [new URL('../runtime/worker.mjs', import.meta.url).pathname, '--database', database, '--context', files.context, '--bindings', files.bindings, '--kanbanger', files.kanbanger, '--interval-ms', '50'],
    { env: { ...process.env, BOB_TEST_KANBANGER_TOKEN: fake.token }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const delivered = new Promise(resolve => child.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.split('\n').some(line => line && JSON.parse(line).delivered)) resolve();
  }));
  await delivered;
  child.kill('SIGTERM');
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0, stderr);
  const lines = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert(lines.some(line => line.step === 'dispatch' && line.outcome === 'dispatched' && line.attemptId === body.attemptId));
  assert.equal(lines.at(-1).step, 'stop');
  for (const secret of [fake.token, 'environment-secret-token']) assert(!(stdout + stderr).includes(secret));
  const c = new ExecutionCoordinator({ database, context }); t.after(() => c.close());
  assert.equal(c.attempt(body.attemptId).state, 'admitted');
  assert.equal(c.db.prepare("SELECT status FROM coordination_issue_effect").get().status, 'delivered');
});
