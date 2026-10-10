import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { executionPort } from '../runtime/execution-port.mjs';
import { outputValidators } from '../runtime/coordinator.mjs';
const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'actor', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob' };
const item = (itemId = 'item-1', completionTarget = 'execution') => ({ itemId, issue: { ...project, issueId: itemId }, issueSnapshotRef: 'snapshot', target, completionTarget });
const query = resourceId => ({ contractVersion: '1', resourceId });
const call = (c, name, body) => c.call(name, body, { idempotencyKey: body.commandId ?? body.requestId });
const validates = (name, value) => { assert(outputValidators.get(name)(value), JSON.stringify(outputValidators.get(name).errors)); return value; };
function setup(t, { items = [item(), item('item-2')], dependencies = [], concurrencyLimit = 1, fault } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-execution-')), database = join(dir, 'store.sqlite');
  let service = new ExecutionCoordinator({ database, context, fault });
  const plan = call(service, 'CreatePlan', { contractVersion: '1', commandId: 'create', plan: { items, dependencies, concurrencyLimit } });
  call(service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, database, planId: plan.resourceId, get service() { return service; }, reopen(nextContext = context) { service.close(); service = new ExecutionCoordinator({ database, context: nextContext }); return service; } };
}
const request = (f, suffix = '1', itemId = 'item-1') => ({ contractVersion: '1', requestId: 'request-'+suffix, attemptId: 'attempt-'+suffix, itemId, planId: f.planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check result'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-44-execution' }, executionProfileId: 'pistache' });
const admission = request => ({ contractVersion: '1', requestId: request.requestId, executionId: 'execution-'+request.attemptId, attemptId: request.attemptId, target: request.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-'+request.attemptId } });
const receipt = (request, outcome = 'succeeded') => ({ contractVersion: '1', eventId: 'event-'+request.attemptId, environmentId: 'bob', executionId: admission(request).executionId, attemptId: request.attemptId, sequence: 1, occurredAt: '2026-10-10T12:00:00Z', outcome, thread: admission(request).thread, sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['execution-log'] });
const port = overrides => ({ requireCapabilities: async () => {}, submit: async r => admission(r), find: async () => null, ...overrides });
const code = expected => error => error.code === expected;

test('request reservation is durable, stable and bounded by execution capacity', t => {
  const f = setup(t), body = request(f);
  const op = validates('RequestExecution', call(f.service, 'RequestExecution', body));
  f.reopen(); assert.deepEqual(call(f.service, 'RequestExecution', body), op);
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'reserved');
  assert.throws(() => call(f.service, 'RequestExecution', request(f, '2', 'item-2')), code('CapacityUnavailable'));
  assert.throws(() => call(f.service, 'RequestExecution', { ...body, work: { ...body.work, title: 'Changed' } }), code('IdempotencyConflict'));
});
test('a lost response recovers admission through lookup without submitting twice', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  let submissions = 0;
  const first = await f.service.dispatchOne(port({ submit: async () => { submissions++; throw new Error('response lost'); } }), { now: 1000, leaseMs: 1000 });
  assert.equal(first.state, 'unknown'); f.reopen();
  assert.equal((await f.service.dispatchOne(port(), { now: 1500, leaseMs: 1000 })).dispatched, false);
  const recovered = await f.service.dispatchOne(port({ find: async () => admission(body), submit: async () => { submissions++; return admission(body); } }), { now: 2001, leaseMs: 1000 });
  assert(recovered.dispatched); assert.equal(submissions, 1);
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'running');
});
test('a process exit during submission leaves a durable lease and recovers through lookup', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  const moduleUrl = new URL('../runtime/execution.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { ExecutionCoordinator } from ${JSON.stringify(moduleUrl)};
    const c = new ExecutionCoordinator(${JSON.stringify({ database: f.database, context })});
    await c.dispatchOne({ requireCapabilities: async () => {}, submit: async () => process.exit(73) }, { now: 1000, leaseMs: 1000 });
  `], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  f.reopen(); assert.equal(f.service.attempt(body.attemptId).state, 'dispatching');
  assert.equal((await f.service.dispatchOne(port(), { now: 1500, leaseMs: 1000 })).dispatched, false);
  let submitted = false;
  const recovered = await f.service.dispatchOne(port({ find: async () => admission(body), submit: async () => { submitted = true; } }), { now: 2001, leaseMs: 1000 });
  assert(recovered.dispatched); assert.equal(submitted, false);
});
test('lookup absence replays the identical request and ambiguous lookup never submits', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  await f.service.dispatchOne(port({ submit: async () => { throw new Error('offline'); } }), { now: 1000, leaseMs: 1000 });
  let submitted;
  const unknown = await f.service.dispatchOne(port({ find: async () => { throw new Error('lookup offline'); }, submit: async r => { submitted = r; } }), { now: 2001, leaseMs: 1000 });
  assert.equal(unknown.state, 'unknown'); assert.equal(submitted, undefined);
  const recovered = await f.service.dispatchOne(port({ submit: async r => { submitted = r; return admission(r); } }), { now: 3002, leaseMs: 1000 });
  assert(recovered.dispatched); assert.deepEqual(submitted, body);
});
test('unknown execution retains capacity and cannot be retried or cancelled', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  await f.service.dispatchOne(port({ submit: async () => { throw new Error('offline'); } }));
  const snapshot = f.service.call('GetItem', query(body.itemId)).item;
  assert.throws(() => call(f.service, 'RetryItem', { contractVersion: '1', commandId: 'retry', itemId: body.itemId, expectedVersion: snapshot.resourceVersion, previousAttemptId: body.attemptId, reason: 'try again' }), code('ExecutionUnknown'));
  assert.throws(() => call(f.service, 'RequestExecution', request(f, '2', 'item-2')), code('CapacityUnavailable'));
  assert.throws(() => call(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'cancel', planId: f.planId, expectedVersion: 2, action: 'cancel' }), code('InvalidTransition'));
});
test('terminal receipt deduplicates, releases capacity and never certifies production', async t => {
  const f = setup(t, { items: [item('item-1', 'production'), item('item-2')] }), body = request(f);
  const op = call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  const received = validates('RecordExecutionReceipt', call(f.service, 'RecordExecutionReceipt', receipt(body)));
  f.reopen(); assert.deepEqual(call(f.service, 'RecordExecutionReceipt', receipt(body)), received);
  const snapshot = validates('GetItem', f.service.call('GetItem', query(body.itemId))).item;
  assert.equal(snapshot.state, 'validating'); assert.deepEqual(snapshot.achievedMilestones, ['execution-succeeded']);
  assert.equal(f.service.call('GetOperation', query(op.operationId)).state, 'succeeded');
  call(f.service, 'RequestExecution', request(f, '2', 'item-2'));
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...receipt(body), outcome: 'failed' }), code('ReceiptConflict'));
});
test('receipt identity, source evidence and sequence gaps reject atomically', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  const original = receipt(body);
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...original, sequence: 2 }), code('SequenceGap'));
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...original, executionId: 'another' }), code('ReceiptConflict'));
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...original, sourceSnapshot: { ...original.sourceSnapshot, dirty: true } }), code('ReceiptConflict'));
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...original, environmentId: 'other' }), code('Forbidden'));
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'running');
  call(f.service, 'RecordExecutionReceipt', original);
});
test('failed attempt retry gets new IDs only after terminal confirmation; old receipts cannot advance it', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  call(f.service, 'RecordExecutionReceipt', receipt(body, 'failed'));
  const snapshot = f.service.call('GetItem', query(body.itemId)).item;
  const retry = { contractVersion: '1', commandId: 'retry', itemId: body.itemId, expectedVersion: snapshot.resourceVersion, previousAttemptId: body.attemptId, reason: 'fix failure' };
  const op = validates('RetryItem', call(f.service, 'RetryItem', retry));
  assert.deepEqual(call(f.service, 'RetryItem', retry), op);
  let second;
  await f.service.dispatchOne(port({ submit: async r => { second = r; return admission(r); } }));
  assert.notEqual(second.attemptId, body.attemptId); assert.notEqual(second.requestId, body.requestId);
  call(f.service, 'RecordExecutionReceipt', receipt(body, 'failed'));
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.currentAttemptId, second.attemptId);
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', { ...receipt(body), eventId: 'another-old-event' }), code('ReceiptConflict'));
  call(f.service, 'RecordExecutionReceipt', receipt(second));
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'completed');
});
test('dependent work waits for its declared milestone and becomes ready on receipt', async t => {
  const dependency = { upstreamItemId: 'item-1', downstreamItemId: 'item-2', requiredMilestone: 'execution-succeeded' };
  const f = setup(t, { dependencies: [dependency] }), body = request(f);
  assert.throws(() => call(f.service, 'RequestExecution', request(f, '2', 'item-2')), code('InvalidTransition'));
  call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  call(f.service, 'RecordExecutionReceipt', receipt(body));
  assert.equal(f.service.call('GetItem', query('item-2')).item.state, 'ready');
  call(f.service, 'RequestExecution', request(f, '2', 'item-2'));
});
test('leased dispatch cannot be duplicated by a competing worker', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  let release, calls = 0;
  const gate = new Promise(resolve => release = resolve);
  const first = f.service.dispatchOne(port({ submit: async r => { calls++; await gate; return admission(r); } }), { now: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  const other = new ExecutionCoordinator({ database: f.database, context });
  try { assert.equal((await other.dispatchOne(port(), { now: 1001 })).dispatched, false); }
  finally { other.close(); release(); }
  assert((await first).dispatched); assert.equal(calls, 1);
});
test('execution write fault rolls back attempt, item, receipt and event updates', t => {
  const f = setup(t, { fault: phase => { if (phase === 'before-execution-commit') throw new Error('crash'); } });
  const before = f.service.pendingNotifications().length;
  assert.throws(() => call(f.service, 'RequestExecution', request(f)), /crash/);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM coordination_attempt').get().n, 0);
  assert.equal(f.service.call('GetItem', query('item-1')).item.state, 'ready');
  assert.equal(f.service.pendingNotifications().length, before);
});
test('version-one local databases migrate using the generated attempt schema', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bob-migration-')), database = join(dir, 'store.sqlite');
  const db = new DatabaseSync(database);
  // Obtain the genuine published v1 SQL, not a hand-written mock schema.
  const prior = readFileSync(new URL('./fixtures/storage-v1.sql', import.meta.url), 'utf8');
  db.exec(prior); db.exec('PRAGMA user_version = 1');
  db.prepare('INSERT INTO coordination_plan VALUES (?,?,?,?,?,?)').run('workspace', 'old-plan', 'actor', '{}', 'draft', 1); db.close();
  const c = new ExecutionCoordinator({ database, context });
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(c.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 1);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_attempt').get().n, 0);
});
test('HTTP port refuses legacy capabilities and preserves IDs, target and environment-local credentials', async t => {
  const f = setup(t), body = request(f), calls = [];
  const capabilities = { contractVersion: '1', operations: ['SubmitExecution', 'FindExecution'], executionProfiles: ['pistache'], validationProfiles: [], eventResume: true, durableExecutionAdmission: true };
  const transport = async (url, options) => {
    calls.push({ url, options });
    const payload = url.endsWith('/capabilities/query') ? capabilities : url.endsWith('/requests/query') ? { type: 'about:blank', title: 'Not found', status: 404, code: 'NotFound', retryable: false } : admission(body);
    return new Response(JSON.stringify(payload), { status: url.endsWith('/requests/query') ? 404 : 200 });
  };
  const p = executionPort({ bindings: [{ target, baseUrl: 'https://bob.example', authToken: 'fixture-token' }], fetch: transport });
  await p.requireCapabilities(body); assert.equal(await p.find(body), null); validates('SubmitExecution', await p.submit(body));
  assert.equal(calls.at(-1).options.headers['idempotency-key'], body.requestId);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), body);
  assert.equal(calls.at(-1).options.redirect, 'error');
  capabilities.durableExecutionAdmission = false;
  await assert.rejects(p.requireCapabilities(body), code('CapabilityUnavailable'));
  assert.equal(calls.filter(call => call.url.endsWith('/requests')).length, 1);
});

test('an expired worker cannot overwrite a newer recovered admission', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  let release;
  const gate = new Promise(resolve => release = resolve);
  const first = f.service.dispatchOne(port({ submit: async r => { await gate; return admission(r); } }), { now: 1000, leaseMs: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  const newer = await f.service.dispatchOne(port({ find: async () => admission(body) }), { now: 2001, leaseMs: 1000 });
  assert(newer.dispatched); release();
  assert.equal((await first).state, 'lease-lost');
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'running');
});
test('paused receipts preserve outcomes and resume unblocks dependencies atomically', async t => {
  const edge = { upstreamItemId: 'item-1', downstreamItemId: 'item-2', requiredMilestone: 'execution-succeeded' };
  const f = setup(t, { dependencies: [edge] }), body = request(f);
  call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  call(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'pause', planId: f.planId, expectedVersion: 2, action: 'pause' });
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'running');
  call(f.service, 'RecordExecutionReceipt', receipt(body));
  assert.equal(f.service.call('GetItem', query('item-2')).item.state, 'pending');
  call(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'resume', planId: f.planId, expectedVersion: 3, action: 'resume' });
  assert.equal(f.service.call('GetItem', query('item-2')).item.state, 'ready');
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'completed');
  const readyVersion = f.service.call('GetItem', query('item-2')).item.resourceVersion;
  call(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'pause-again', planId: f.planId, expectedVersion: 4, action: 'pause' });
  assert(f.service.call('GetItem', query('item-2')).item.resourceVersion > readyVersion);
});
test('invalid admission and failed capability checks cannot release the reservation', async t => {
  const f = setup(t), body = request(f); call(f.service, 'RequestExecution', body);
  let submissions = 0;
  const capabilityFailure = await f.service.dispatchOne(port({ requireCapabilities: async () => { throw Object.assign(new Error('legacy server'), { code: 'CapabilityUnavailable' }); }, submit: async () => { submissions++; } }), { now: 1000, leaseMs: 1000 });
  assert.equal(capabilityFailure.error.code, 'CapabilityUnavailable'); assert.equal(submissions, 0);
  const mismatch = await f.service.dispatchOne(port({ submit: async r => ({ ...admission(r), target: { ...target, environmentId: 'another' } }) }), { now: 2001, leaseMs: 1000 });
  assert.equal(mismatch.state, 'unknown'); assert.equal(mismatch.error.code, 'TargetMismatch');
  assert.throws(() => call(f.service, 'RequestExecution', request(f, '2', 'item-2')), code('CapacityUnavailable'));
});
test('terminal receipt failure rolls back its fact, operation and dependent readiness', async t => {
  const f = setup(t), body = request(f); const op = call(f.service, 'RequestExecution', body); await f.service.dispatchOne(port());
  f.service.fault = phase => { if (phase === 'before-execution-commit') throw new Error('receipt crash'); };
  assert.throws(() => call(f.service, 'RecordExecutionReceipt', receipt(body)), /receipt crash/);
  f.reopen();
  assert.equal(f.service.attempt(body.attemptId).state, 'admitted');
  assert.equal(f.service.call('GetOperation', query(op.operationId)).state, 'running');
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'running');
  call(f.service, 'RecordExecutionReceipt', receipt(body));
  assert.equal(f.service.call('GetItem', query(body.itemId)).item.state, 'completed');
});
