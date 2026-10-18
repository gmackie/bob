import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { kanbangerClient, kanbangerIssueResolver } from '../runtime/kanbanger.mjs';
import { deliverIssueEffect, drainIssueEffects, effectMarker } from '../runtime/issue-effects.mjs';
import { fakeKanbanger, teamId, projectId, otherProjectId, issueUuid, states } from './fixtures/fake-kanbanger.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'BOB', projectId };
const context = { workspaceId: 'workspace', actorId: 'actor', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob' };
const issue = (identifier = 'BOB-37', extra = {}) => ({ ...project, issueId: identifier, identifier, ...extra });
const item = (itemId = 'item-1', issueRef = issue()) => ({ itemId, issue: issueRef, issueSnapshotRef: 'snapshot', target, completionTarget: 'production' });
const call = (c, name, body) => c.call(name, body, { idempotencyKey: body.commandId ?? body.requestId });
const admit = (c, name, body) => c.admit(name, body, { idempotencyKey: body.commandId ?? body.requestId });
const code = expected => error => error.code === expected;
const request = (planId, suffix = '1', itemId = 'item-1') => ({ contractVersion: '1', requestId: 'request-' + suffix, attemptId: 'attempt-' + suffix, itemId, planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check result'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-54' }, executionProfileId: 'pistache' });
const admission = r => ({ contractVersion: '1', requestId: r.requestId, executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, target: r.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-' + r.attemptId } });
const receipt = (r, outcome = 'succeeded') => ({ contractVersion: '1', eventId: 'event-' + r.attemptId, environmentId: 'bob', executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, sequence: 1, occurredAt: '2026-10-18T12:00:00Z', outcome, thread: admission(r).thread, sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['execution-log'] });
const port = { requireCapabilities: async () => {}, submit: async r => admission(r), find: async () => null };
const effects = c => c.db.prepare('SELECT * FROM coordination_issue_effect ORDER BY rowid').all();

async function kanbanger(t) {
  const fake = await fakeKanbanger();
  t.after(() => fake.close());
  return { fake, client: kanbangerClient({ endpoint: fake.endpoint, token: fake.token, integrationId: 'kanbanger', timeoutMs: 2000 }) };
}
async function setup(t, { resolver, items = [item(), item('item-2', issue('BOB-37'))], fault } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-kanbanger-')), database = join(dir, 'store.sqlite');
  let service = new ExecutionCoordinator({ database, context, fault, issueResolver: resolver });
  const plan = await admit(service, 'CreatePlan', { contractVersion: '1', commandId: 'create', plan: { items, dependencies: [], concurrencyLimit: 2 } });
  call(service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  return { database, planId: plan.resourceId, get service() { return service; }, reopen(options = {}) { service.close(); service = new ExecutionCoordinator({ database, context, issueResolver: resolver, ...options }); return service; } };
}

test('client resolves identifiers, discovers and caches states, mutates by UUID and reads back', async t => {
  const { fake, client } = await kanbanger(t);
  const snapshot = await client.resolveIssue('BOB-37');
  assert.deepEqual(snapshot, { id: issueUuid, identifier: 'BOB-37', title: 'Coordinate', url: 'https://tasks.example/BOB-37', state: { id: states[0].id, name: 'Todo', type: 'unstarted' }, team: { id: teamId, key: 'BOB', name: 'Bob' }, project: { id: projectId, name: 'Project' } });
  assert.equal(fake.calls[0].headers.authorization, fake.token);
  assert.deepEqual(await client.workflowStates(teamId), states);
  await client.workflowStates(teamId);
  assert.equal(fake.calls.filter(c => c.operation === 'BobCoordinationStates').length, 1);
  const after = await client.updateIssueState(issueUuid, states[1].id);
  assert.equal(after.state.name, 'In Progress');
  const hostile = 'Quote " and } { mutation evil } \\ text';
  await client.createComment(issueUuid, hostile);
  const sent = fake.calls.find(c => c.operation === 'BobCoordinationComment').body;
  assert.equal(sent.variables.body, hostile); assert(!sent.query.includes('Quote'));
  assert.deepEqual((await client.issueComments(issueUuid)).map(c => c.body), [hostile]);
  await assert.rejects(client.updateIssueState('BOB-37', states[1].id), code('InvalidRequest'));
  await assert.rejects(client.createComment('BOB-37', 'x'), code('InvalidRequest'));
  assert.equal(fake.mutations().length, 2);
});

test('client errors are structured, classify retryability and never contain the token', async t => {
  const { fake, client } = await kanbanger(t);
  await assert.rejects(client.resolveIssue('BOB-404'), error => error.code === 'IssueNotFound' && error.status === 404 && !error.retryable);
  fake.failNext.push((_q, _r, send) => send(503, { errors: [{ message: 'down' }] }));
  await assert.rejects(client.resolveIssue('BOB-37'), error => error.code === 'KanbangerUnavailable' && error.retryable);
  fake.failNext.push((_q, _r, send) => send(200, { data: null, errors: [{ message: 'Field is broken' }] }));
  await assert.rejects(client.resolveIssue('BOB-37'), error => error.code === 'KanbangerRejected' && !error.retryable);
  fake.failNext.push((_q, response) => { response.writeHead(302, { Location: 'https://elsewhere.example/graphql' }); response.end(); });
  await assert.rejects(client.resolveIssue('BOB-37'), error => error.code === 'KanbangerUnavailable');
  fake.failNext.push(() => {});
  const slow = kanbangerClient({ endpoint: fake.endpoint, token: fake.token, integrationId: 'kanbanger', timeoutMs: 200 });
  await assert.rejects(slow.resolveIssue('BOB-37'), error => error.code === 'KanbangerUnavailable' && /timeout/.test(error.message));
  const wrong = kanbangerClient({ endpoint: fake.endpoint, token: 'wrong-secret-token-value', integrationId: 'kanbanger' });
  await assert.rejects(wrong.resolveIssue('BOB-37'), error => error.code === 'KanbangerUnauthorized' && !JSON.stringify({ m: error.message, s: error.stack }).includes('wrong-secret-token-value'));
  assert.throws(() => kanbangerClient({ endpoint: 'http://tasks.example/graphql', token: fake.token, integrationId: 'kanbanger' }), code('InvalidRequest'));
  assert.throws(() => kanbangerClient({ endpoint: 'https://user:pw@tasks.example/graphql', token: fake.token, integrationId: 'kanbanger' }), code('InvalidRequest'));
  assert.throws(() => kanbangerClient({ endpoint: fake.endpoint, integrationId: 'kanbanger' }), code('InvalidRequest'));
});

test('admission resolves issues against the policy; unresolved or foreign issues never admit', async t => {
  const { client } = await kanbanger(t);
  const resolver = kanbangerIssueResolver(client);
  const f = await setup(t, { resolver });
  // Synchronous call() cannot bypass resolution when a resolver is configured.
  assert.throws(() => call(f.service, 'RequestExecution', request(f.planId)), code('IssueUnverified'));
  const op = await admit(f.service, 'RequestExecution', request(f.planId));
  assert.equal(op.state, 'accepted');
  assert.deepEqual(await admit(f.service, 'RequestExecution', request(f.planId)), op);
  const plan = items => ({ contractVersion: '1', commandId: 'plan-' + items[0].itemId, plan: { items, dependencies: [], concurrencyLimit: 1 } });
  await assert.rejects(admit(f.service, 'CreatePlan', plan([item('foreign', issue('BOB-99'))])), code('IssueProjectMismatch'));
  await assert.rejects(admit(f.service, 'CreatePlan', plan([item('missing', issue('BOB-404'))])), code('IssueNotFound'));
  await assert.rejects(admit(f.service, 'CreatePlan', plan([item('renamed', issue('BOB-37', { issueId: 'BOB-38' }))])), code('IssueMismatch'));
  await assert.rejects(admit(f.service, 'CreatePlan', plan([item('other-integration', issue('BOB-37', { integrationId: 'linear' }))])), error => error.code === 'Forbidden' || error.code === 'IssueUnresolvable');
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 1);
  // An issue that moved project since planning is rejected at execution admission.
  client.resolveIssue = async () => ({ id: issueUuid, identifier: 'BOB-37', team: { id: teamId, key: 'BOB' }, project: { id: otherProjectId } });
  await assert.rejects(admit(f.service, 'RequestExecution', request(f.planId, '2', 'item-2')), code('IssueProjectMismatch'));
  assert.equal(effects(f.service).length, 1);
});

test('without a resolver admission is unchanged and every attempt writes one admitted effect atomically', async t => {
  const f = await setup(t);
  const body = request(f.planId);
  f.service.fault = phase => { if (phase === 'before-execution-commit') throw new Error('crash'); };
  assert.throws(() => call(f.service, 'RequestExecution', body), /crash/);
  assert.equal(effects(f.service).length, 0);
  f.service.fault = () => {};
  call(f.service, 'RequestExecution', body); call(f.service, 'RequestExecution', body);
  f.reopen(); call(f.service, 'RequestExecution', body);
  const rows = effects(f.service);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'attempt-1:admitted'); assert.equal(rows[0].status, 'pending');
  assert.deepEqual(JSON.parse(rows[0].payload).issue, issue());
});

test('terminal receipts write one effect in the receipt transaction; replay adds nothing', async t => {
  const f = await setup(t), body = request(f.planId);
  call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port);
  f.service.fault = phase => { if (phase === 'before-execution-commit') throw new Error('receipt crash'); };
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', receipt(body)), /receipt crash/);
  assert.deepEqual(effects(f.service).map(row => row.fact), ['admitted']);
  f.service.fault = () => {};
  call(f.service, 'RecordExecutionReceipt', receipt(body)); f.reopen(); call(f.service, 'RecordExecutionReceipt', receipt(body));
  const rows = effects(f.service);
  assert.deepEqual(rows.map(row => row.fact), ['admitted', 'execution-succeeded']);
  const payload = JSON.parse(rows[1].payload);
  assert.equal(payload.requestId, 'request-1'); assert.equal(payload.commitSha, 'b'.repeat(40)); assert.equal(payload.treeDigest, 'c'.repeat(64));
  assert.equal(payload.thread.threadId, 'thread-attempt-1'); assert.equal(payload.environmentId, 'bob');
});

test('drain sets In Progress on admission, comments receipts, never sets Done and is exactly-once across a crash', async t => {
  const { fake, client } = await kanbanger(t);
  const f = await setup(t), body = request(f.planId);
  call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port);
  call(f.service, 'RecordExecutionReceipt', receipt(body));
  // Crash after the Kanbanger write but before the row settles.
  f.service.fault = phase => { if (phase === 'before-effect-settle') throw new Error('worker crash'); };
  await assert.rejects(deliverIssueEffect(f.service, client, { now: 1000 }), /worker crash/);
  assert.equal(fake.issues.get(issueUuid).stateId, states[1].id);
  f.reopen();
  assert.equal(effects(f.service)[0].status, 'pending');
  assert.equal((await deliverIssueEffect(f.service, client, { now: 1500 })).outcome, 'delivered'); // the receipt comment; admitted row still leased
  assert.equal((await deliverIssueEffect(f.service, client, { now: 1600 })).delivered, false);
  const replayed = await deliverIssueEffect(f.service, client, { now: 61001 });
  assert.equal(replayed.outcome, 'delivered'); assert.equal(replayed.action, 'state-unchanged');
  // A crash between comment creation and settle is detected by its marker.
  call(f.service, 'RequestExecution', request(f.planId, '2', 'item-2')); await f.service.dispatchOne(port);
  call(f.service, 'RecordExecutionReceipt', receipt(request(f.planId, '2', 'item-2'), 'failed'));
  await drainIssueEffects(f.service, client, { now: 62000, limit: 1 });
  f.service.fault = phase => { if (phase === 'before-effect-settle') throw new Error('worker crash'); };
  await assert.rejects(deliverIssueEffect(f.service, client, { now: 62000 }), /worker crash/);
  f.reopen();
  const recovered = await deliverIssueEffect(f.service, client, { now: 200000 });
  assert.equal(recovered.action, 'comment-present'); assert.equal(recovered.outcome, 'delivered');
  const comments = fake.issues.get(issueUuid).comments;
  assert.equal(comments.length, 2);
  assert.equal(comments.filter(c => c.body.includes(effectMarker('attempt-2:execution-failed'))).length, 1);
  const success = comments.find(c => c.body.includes(effectMarker('attempt-1:execution-succeeded'))).body;
  for (const fact of ['request-1', 'attempt-1', '`bob`', 'thread-attempt-1', 'b'.repeat(40), 'c'.repeat(64), 'does not certify']) assert(success.includes(fact), fact);
  assert(effects(f.service).every(row => row.status === 'delivered' && row.delivered_at));
  const stateWrites = fake.calls.filter(c => c.operation === 'BobCoordinationState');
  assert.equal(stateWrites.length, 1); assert.equal(stateWrites[0].body.variables.id, issueUuid);
  assert(!stateWrites.some(c => c.body.variables.stateId === states[3].id));
  assert.equal((await drainIssueEffects(f.service, client, { now: 300000 })).processed, 0);
});

test('delivery failures back off durably and terminal issue errors are rejected', async t => {
  const { fake, client } = await kanbanger(t);
  const f = await setup(t), body = request(f.planId);
  call(f.service, 'RequestExecution', body);
  fake.failNext.push((_q, _r, send) => send(500, {}));
  const failed = await deliverIssueEffect(f.service, client, { now: 1000, random: () => 0.5 });
  assert.equal(failed.outcome, 'retry'); assert.equal(failed.error.code, 'KanbangerUnavailable');
  f.reopen();
  let row = effects(f.service)[0];
  assert.equal(row.delivery_attempts, 1); assert.equal(row.next_attempt_at, 6000); assert.match(row.last_error, /KanbangerUnavailable/);
  assert(!row.last_error.includes(fake.token));
  assert.equal((await deliverIssueEffect(f.service, client, { now: 5999 })).delivered, false);
  assert.equal((await deliverIssueEffect(f.service, client, { now: 6000 })).outcome, 'delivered');
  row = effects(f.service)[0]; assert.equal(row.delivery_attempts, 2); assert.equal(row.last_error, null);
  // An issue that left the admitted project is a terminal rejection, not a write.
  call(f.service, 'RequestExecution', request(f.planId, '2', 'item-2'));
  fake.issues.get(issueUuid).projectId = otherProjectId;
  fake.issues.get(issueUuid).stateId = states[0].id;
  const rejected = await deliverIssueEffect(f.service, client, { now: 7000 });
  assert.equal(rejected.outcome, 'rejected'); assert.equal(rejected.error.code, 'IssueProjectMismatch');
  assert.equal(fake.issues.get(issueUuid).stateId, states[0].id);
});

test('database v2 upgrades to v3 transactionally and unsupported versions fail', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bob-migration-v2-')), database = join(dir, 'store.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(database);
  db.exec(readFileSync(new URL('./fixtures/storage-v2.sql', import.meta.url), 'utf8')); db.exec('PRAGMA user_version = 2');
  db.prepare('INSERT INTO coordination_plan VALUES (?,?,?,?,?,?)').run('workspace', 'old-plan', 'actor', '{}', 'draft', 1); db.close();
  const c = new ExecutionCoordinator({ database, context });
  assert.equal(c.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 1);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_issue_effect').get().n, 0);
  assert(c.db.prepare("SELECT name FROM sqlite_master WHERE name='coordination_issue_effect_uq_attemptId_fact'").get());
  c.close();
  const reopened = new ExecutionCoordinator({ database, context }); reopened.close();
  const broken = join(dir, 'broken.sqlite'), raw = new DatabaseSync(broken);
  raw.exec(readFileSync(new URL('./fixtures/storage-v2.sql', import.meta.url), 'utf8'));
  raw.exec('CREATE TABLE coordination_issue_effect (x TEXT)'); raw.exec('PRAGMA user_version = 2'); raw.close();
  assert.throws(() => new ExecutionCoordinator({ database: broken, context }));
  const check = new DatabaseSync(broken);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 2); check.close();
  const future = join(dir, 'future.sqlite'), next = new DatabaseSync(future); next.exec('PRAGMA user_version = 4'); next.close();
  assert.throws(() => new ExecutionCoordinator({ database: future, context }), code('StorageVersion'));
});

test('HTTP host resolves issues before admission when configured', async t => {
  const { coordinationServer } = await import('../runtime/http.mjs');
  const { createClient } = await import('../generated/client.mjs');
  const { client } = await kanbanger(t);
  const dir = mkdtempSync(join(tmpdir(), 'bob-http-kanbanger-')), token = 'test-only-credential-with-at-least-32-characters';
  const server = coordinationServer({ database: join(dir, 'store.sqlite'), principals: [{ token, context, operations: ['CreatePlan'] }], issueResolver: kanbangerIssueResolver(client) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeIdleConnections(); await closed; rmSync(dir, { recursive: true, force: true }); });
  const api = createClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, headers: { Authorization: `Bearer ${token}` } }).functions;
  const body = id => ({ contractVersion: '1', commandId: id, plan: { items: [item(id, issue(id === 'good' ? 'BOB-37' : 'BOB-99'))], dependencies: [], concurrencyLimit: 1 } });
  assert.equal((await api.createPlan(body('good'), { idempotencyKey: 'good' })).state, 'succeeded');
  await assert.rejects(api.createPlan(body('bad'), { idempotencyKey: 'bad' }), error => error.code === 'IssueProjectMismatch' && error.status === 403);
});

