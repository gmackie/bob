import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { CoordinationError, outputValidators, storageVersion } from '../runtime/coordinator.mjs';
import { classifyCommandError, edgeExporter, loadEdgeConfig, FAST_POLL_MS, INTERNAL_ERROR, MAX_RESULTS_PER_BATCH, RELAYED_OPERATIONS } from '../runtime/edge.mjs';
import { runWorker } from '../runtime/worker.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'edge-principal', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob' };
const item = (itemId, completionTarget = 'execution') => ({ itemId, issue: { ...project, issueId: itemId }, issueSnapshotRef: 'snapshot', target, completionTarget });
const call = (c, name, body, extra = {}) => c.call(name, { contractVersion: '1', ...body }, { idempotencyKey: body.commandId ?? body.requestId, ...extra });
const code = expected => error => error.code === expected;
const getItem = (c, id) => c.call('GetItem', { contractVersion: '1', resourceId: id }).item;
const request = (planId, suffix = '1', itemId = 'item-1') => ({ requestId: 'request-' + suffix, attemptId: 'attempt-' + suffix, itemId, planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-79' }, executionProfileId: 'pistache' });
const admission = r => ({ contractVersion: '1', requestId: r.requestId, executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, target: r.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-' + r.attemptId } });
const receipt = (r, outcome = 'succeeded') => ({ contractVersion: '1', eventId: 'event-' + r.attemptId, environmentId: 'bob', executionId: admission(r).executionId, attemptId: r.attemptId, sequence: 1, occurredAt: '2026-11-15T12:00:00Z', outcome, thread: admission(r).thread, sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['log'] });
const port = overrides => ({ requireCapabilities: async () => {}, submit: async r => admission(r), find: async () => null, ...overrides });
const log = (c, id) => c.db.prepare('SELECT * FROM coordination_command_log WHERE command_id=? ORDER BY created_at, rowid').all(id).at(-1);
const logRows = (c, id) => c.db.prepare('SELECT * FROM coordination_command_log WHERE command_id=? ORDER BY created_at, rowid').all(id);

function setup(t, { items = [item('item-1'), item('item-2')], concurrencyLimit = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-commands-')), database = join(dir, 'store.sqlite');
  const c = new ExecutionCoordinator({ database, context });
  const plan = call(c, 'CreatePlan', { commandId: 'create', plan: { items, dependencies: [], concurrencyLimit } });
  call(c, 'ControlPlan', { commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { c, dir, database, planId: plan.resourceId };
}
const cancel = (c, commandId, itemId, expectedVersion, extra) => call(c, 'CancelItem', { commandId, itemId, expectedVersion }, extra);

test('CancelItem rejects a stale expectedVersion and logs the refusal', t => {
  const { c } = setup(t);
  const version = getItem(c, 'item-1').resourceVersion;
  assert.throws(() => cancel(c, 'cancel-stale', 'item-1', version + 1), code('VersionConflict'));
  assert.equal(getItem(c, 'item-1').state, 'ready');
  const row = log(c, 'cancel-stale');
  assert.equal(row.outcome, 'VersionConflict'); assert.equal(row.operation_id, null); assert.equal(row.resource_id, 'item-1');
  // The same commandId can still succeed later: a new row records the effect, the refusal row stays.
  const op = cancel(c, 'cancel-stale', 'item-1', version);
  assert.equal(log(c, 'cancel-stale').operation_id, op.operationId);
  assert.deepEqual(logRows(c, 'cancel-stale').map(r => [r.outcome, r.operation_id]), [['VersionConflict', null], ['succeeded', op.operationId]]);
});

test('the command log is append-only: a refusal after success, or a replay, never overwrites a row', t => {
  const { c } = setup(t);
  const version = getItem(c, 'item-1').resourceVersion;
  const op = cancel(c, 'cancel-log', 'item-1', version, { actor: 'bob-user-1' });
  const first = logRows(c, 'cancel-log');
  cancel(c, 'cancel-log', 'item-1', version, { actor: 'bob-user-1' }); // replay: no row
  assert.throws(() => cancel(c, 'cancel-log', 'item-2', version, { actor: 'bob-user-2' }), code('IdempotencyConflict'));
  const rows = logRows(c, 'cancel-log');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], first[0]);
  assert.deepEqual([rows[0].outcome, rows[0].operation_id, rows[0].actor], ['succeeded', op.operationId, 'bob-user-1']);
  assert.deepEqual([rows[1].outcome, rows[1].operation_id, rows[1].actor], ['IdempotencyConflict', null, 'bob-user-2']);
  assert.notEqual(rows[0].id, rows[1].id);
  assert(c.db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='coordination_command_log_ix_by_command_id'").get());
});

test('cancel keeps achieved milestones on the immediate and the deferred path', async t => {
  const { c, planId } = setup(t, { items: [item('item-1', 'production'), item('item-2', 'production')], concurrencyLimit: 2 });
  const body = request(planId); call(c, 'RequestExecution', body);
  await c.dispatchOne(port());
  c.call('RecordExecutionReceipt', receipt(body, 'succeeded'));
  assert.equal(getItem(c, 'item-1').state, 'validating');
  cancel(c, 'cancel-validating', 'item-1', getItem(c, 'item-1').resourceVersion);
  assert.deepEqual(getItem(c, 'item-1').achievedMilestones, ['execution-succeeded']);
  // Deferred: a cancelling item that already holds a milestone keeps it when the execution ends.
  const second = request(planId, '2', 'item-2'); call(c, 'RequestExecution', second);
  await c.dispatchOne(port());
  const running = getItem(c, 'item-2');
  c.db.prepare('UPDATE coordination_item SET snapshot=? WHERE tenant=? AND id=?').run(JSON.stringify({ ...running, achievedMilestones: ['execution-succeeded'] }), c.tenant, 'item-2');
  assert.equal(cancel(c, 'cancel-deferred', 'item-2', running.resourceVersion).state, 'accepted');
  c.call('RecordExecutionReceipt', receipt(second, 'failed'));
  assert.equal(getItem(c, 'item-2').state, 'cancelled');
  assert.deepEqual(getItem(c, 'item-2').achievedMilestones, ['execution-succeeded']);
  assert.deepEqual(logRows(c, 'cancel-deferred').map(r => r.outcome), ['accepted', 'succeeded']);
});

test('a cancelling item settles while its plan is paused, and the paused plan dispatches nothing new', async t => {
  const { c, planId } = setup(t, { concurrencyLimit: 2 });
  call(c, 'RequestExecution', request(planId));
  await c.dispatchOne(port({ submit: async () => { throw new Error('offline'); } }), { now: 1000, leaseMs: 1000 });
  assert.equal(getItem(c, 'item-1').state, 'execution-unknown');
  call(c, 'RequestExecution', request(planId, '2', 'item-2')); // queued, never submitted
  assert.equal(cancel(c, 'cancel-paused', 'item-1', getItem(c, 'item-1').resourceVersion).state, 'accepted');
  call(c, 'ControlPlan', { commandId: 'pause', planId, expectedVersion: 2, action: 'pause' });
  let submitted = 0;
  const settle = await c.dispatchOne(port({ submit: async r => { submitted++; return admission(r); } }), { now: 3000, leaseMs: 1000 });
  assert.equal(settle.state, 'cancelled'); assert.equal(getItem(c, 'item-1').state, 'cancelled');
  assert.deepEqual(await c.dispatchOne(port({ submit: async r => { submitted++; return admission(r); } }), { now: 4000, leaseMs: 1000 }), { dispatched: false });
  assert.equal(submitted, 0); assert.equal(c.attempt('attempt-2').state, 'queued');
});

test('CancelItem replay returns the same Operation with one effect; a different payload conflicts', t => {
  const { c } = setup(t);
  const version = getItem(c, 'item-1').resourceVersion;
  const op = cancel(c, 'cancel-1', 'item-1', version);
  assert(outputValidators.get('CancelItem')(op));
  assert.equal(op.state, 'succeeded'); assert.equal(op.resourceId, 'item-1');
  const after = getItem(c, 'item-1');
  assert.equal(after.state, 'cancelled'); assert.equal(after.resourceVersion, version + 1);
  const operations = c.db.prepare('SELECT COUNT(*) AS n FROM coordination_operation').get().n;
  assert.deepEqual(cancel(c, 'cancel-1', 'item-1', version), op);
  assert.equal(getItem(c, 'item-1').resourceVersion, version + 1);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_operation').get().n, operations);
  assert.throws(() => cancel(c, 'cancel-1', 'item-2', version), code('IdempotencyConflict'));
  assert.throws(() => cancel(c, 'cancel-again', 'item-1', version + 1), code('InvalidTransition'));
});

test('the actor is recorded in the command log beside the principal owner', t => {
  const { c, planId } = setup(t);
  const op = cancel(c, 'cancel-actor', 'item-1', getItem(c, 'item-1').resourceVersion, { actor: 'bob-user-42' });
  const row = log(c, 'cancel-actor');
  assert.deepEqual({ owner: row.owner, operation: row.operation, actor: row.actor, resource: row.resource_id, operationId: row.operation_id, outcome: row.outcome },
    { owner: 'edge-principal', operation: 'CancelItem', actor: 'bob-user-42', resource: 'item-1', operationId: op.operationId, outcome: 'succeeded' });
  assert.equal(log(c, 'start').actor, null); assert.equal(log(c, 'start').resource_id, planId); assert.equal(log(c, 'create').operation, 'CreatePlan');
  assert.throws(() => cancel(c, 'cancel-long', 'item-2', 1, { actor: 'x'.repeat(201) }), code('InvalidRequest'));
  assert.throws(() => cancel(c, 'cancel-empty', 'item-2', 1, { actor: '' }), code('InvalidRequest'));
});

test('CancelItem on a queued attempt cancels it at once and frees its capacity', async t => {
  const { c, planId } = setup(t);
  const reserved = call(c, 'RequestExecution', request(planId));
  assert.throws(() => call(c, 'RequestExecution', request(planId, '2', 'item-2')), code('CapacityUnavailable'));
  const op = cancel(c, 'cancel-queued', 'item-1', getItem(c, 'item-1').resourceVersion);
  assert.equal(op.state, 'succeeded'); assert.equal(getItem(c, 'item-1').state, 'cancelled');
  assert.equal(c.attempt('attempt-1').state, 'terminal');
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: reserved.operationId }).state, 'cancelled');
  let submitted = 0;
  call(c, 'RequestExecution', request(planId, '2', 'item-2'));
  await c.dispatchOne(port({ submit: async r => { submitted++; assert.equal(r.attemptId, 'attempt-2'); return admission(r); } }));
  assert.equal(submitted, 1);
});

test('CancelItem on a running item waits in cancelling until the execution ends', async t => {
  const { c, planId } = setup(t);
  const body = request(planId); call(c, 'RequestExecution', body);
  await c.dispatchOne(port());
  assert.equal(getItem(c, 'item-1').state, 'running');
  const op = cancel(c, 'cancel-running', 'item-1', getItem(c, 'item-1').resourceVersion, { actor: 'bob-user-1' });
  assert.equal(op.state, 'accepted'); assert.equal(getItem(c, 'item-1').state, 'cancelling');
  c.call('RecordExecutionReceipt', receipt(body, 'succeeded'));
  const final = getItem(c, 'item-1');
  assert.equal(final.state, 'cancelled'); assert.deepEqual(final.achievedMilestones, []);
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state, 'succeeded');
  assert.equal(log(c, 'cancel-running').outcome, 'succeeded');
  // The replay now reports the stored acceptance, unchanged.
  assert.deepEqual(cancel(c, 'cancel-running', 'item-1', op.resourceVersion - 1, { actor: 'bob-user-1' }), op);
});

test('CancelItem on unknown execution never submits a new execution', async t => {
  const { c, planId } = setup(t);
  call(c, 'RequestExecution', request(planId));
  await c.dispatchOne(port({ submit: async () => { throw new Error('offline'); } }), { now: 1000, leaseMs: 1000 });
  assert.equal(getItem(c, 'item-1').state, 'execution-unknown');
  assert.equal(cancel(c, 'cancel-unknown', 'item-1', getItem(c, 'item-1').resourceVersion).state, 'accepted');
  let submitted = 0;
  const result = await c.dispatchOne(port({ submit: async r => { submitted++; return admission(r); } }), { now: 3000, leaseMs: 1000 });
  assert.equal(result.state, 'cancelled'); assert.equal(submitted, 0);
  assert.equal(getItem(c, 'item-1').state, 'cancelled'); assert.equal(c.attempt('attempt-1').state, 'terminal');
});

test('ReconcileItem only applies to execution-unknown and re-runs the worker recovery at once', async t => {
  const { c, planId } = setup(t);
  assert.throws(() => call(c, 'ReconcileItem', { commandId: 'reconcile-ready', itemId: 'item-1' }), code('InvalidTransition'));
  const body = request(planId); call(c, 'RequestExecution', body);
  assert.throws(() => call(c, 'ReconcileItem', { commandId: 'reconcile-reserved', itemId: 'item-1' }), code('InvalidTransition'));
  await c.dispatchOne(port({ submit: async () => { throw new Error('offline'); } }), { now: 1000, leaseMs: 60000 });
  const unknown = getItem(c, 'item-1');
  assert.equal(unknown.state, 'execution-unknown');
  // Back-off holds the attempt until 61000; ReconcileItem makes it eligible now.
  assert.equal((await c.dispatchOne(port(), { now: 2000, leaseMs: 60000 })).dispatched, false);
  const op = call(c, 'ReconcileItem', { commandId: 'reconcile-1', itemId: 'item-1' }, { actor: 'bob-user-7' });
  assert(outputValidators.get('ReconcileItem')(op)); assert.equal(op.state, 'accepted'); assert.equal(op.resourceVersion, unknown.resourceVersion);
  assert.deepEqual(call(c, 'ReconcileItem', { commandId: 'reconcile-1', itemId: 'item-1' }), op);
  assert.equal(call(c, 'ReconcileItem', { commandId: 'reconcile-2', itemId: 'item-1' }).state, 'accepted'); // repeat is harmless
  assert.equal(getItem(c, 'item-1').resourceVersion, unknown.resourceVersion);
  let submitted = 0;
  const recovered = await c.dispatchOne(port({ find: async () => admission(body), submit: async () => { submitted++; } }), { now: 2001, leaseMs: 60000 });
  assert(recovered.dispatched); assert.equal(submitted, 0);
  assert.equal(getItem(c, 'item-1').state, 'running');
  assert.equal(log(c, 'reconcile-1').actor, 'bob-user-7');
  assert.throws(() => call(c, 'ReconcileItem', { commandId: 'reconcile-3', itemId: 'item-1' }), code('InvalidTransition'));
});

test('capabilities advertise CancelItem and ReconcileItem, not TriggerPlan', t => {
  const { c, planId } = setup(t);
  const { operations } = c.call('GetCapabilities', { contractVersion: '1' });
  assert(operations.includes('CancelItem') && operations.includes('ReconcileItem'));
  assert(!operations.includes('TriggerPlan'));
  assert.throws(() => call(c, 'TriggerPlan', { commandId: 'trigger', planId, planVersion: 2, scheduleId: 's', occurrenceId: 'o', scheduledAt: '2026-11-15T00:00:00Z', overlapPolicy: 'skip' }), code('CapabilityUnavailable'));
});

test('a version-three store gains the command log table', t => {
  const { c, database } = setup(t);
  // Exactly the rollbacks in deploy/coordination/README.md ("Storage version 5 rollback", then "Storage version 4 rollback").
  c.db.exec('BEGIN; DROP TABLE coordination_input_delivery; PRAGMA user_version = 4; COMMIT;');
  c.db.exec('BEGIN; DROP TABLE coordination_command_log; PRAGMA user_version = 3; COMMIT;');
  assert.equal(c.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(c.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'coordination_command_log%'").all(), []);
  assert.equal(c.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const reopened = new ExecutionCoordinator({ database, context }); t.after(() => reopened.close());
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, storageVersion);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM coordination_command_log').get().n, 0);
  // The upgrade creates the final, append-only schema: a row id plus an indexed command_id.
  assert.deepEqual(reopened.db.prepare('PRAGMA table_info(coordination_command_log)').all().filter(col => col.pk).map(col => col.name), ['tenant', 'id']);
  assert(reopened.db.prepare('PRAGMA table_info(coordination_command_log)').all().some(col => col.name === 'command_id'));
  assert.deepEqual(reopened.db.prepare('PRAGMA index_list(coordination_command_log)').all().map(ix => ix.name).filter(n => !n.startsWith('sqlite_')).sort(),
    ['coordination_command_log_ix_by_command_id', 'coordination_command_log_ix_by_owner_created_at']);
});

// ---- Exporter command channel -------------------------------------------------

const TOKEN = 't'.repeat(40), ENDPOINT = 'https://bob.test/api/sdlc/ingest';
function edgeFixture(t) {
  const base = setup(t);
  const checkpoint = join(base.dir, 'edge.sqlite');
  const batches = []; let clock = 1_000;
  let reply = body => ({ accepted: true, watermark: body.watermark });
  const fetch = async (_url, request) => {
    const body = JSON.parse(request.body); batches.push(body);
    const answer = reply(body);
    return answer instanceof Response ? answer : Response.json(answer);
  };
  const options = (extra = {}) => ({ coordinator: base.c, endpoint: ENDPOINT, token: TOKEN, checkpoint, fetch, now: () => clock, commands: { operations: [...RELAYED_OPERATIONS] }, ...extra });
  return { ...base, checkpoint, batches, options, setReply: fn => { reply = fn; }, tick: ms => { clock += ms; } };
}
const queued = (commandId, operation, input, actor = 'bob-user-1') => ({ commandId, actor, queuedAt: 1, operation, input });
const once = (commands, extra = {}) => { let sent = false; return body => { const answer = { accepted: true, watermark: body.watermark, ...extra }; if (!sent) { sent = true; if (commands) answer.commands = commands; } return answer; }; };

test('relayed commands run once under the edge principal, even when delivered twice', async t => {
  const f = edgeFixture(t);
  const exporter = edgeExporter(f.options()); t.after(() => exporter.close());
  const version = getItem(f.c, 'item-1').resourceVersion;
  const command = queued('cmd-1', 'CancelItem', { itemId: 'item-1', expectedVersion: version });
  f.setReply(body => ({ accepted: true, watermark: body.watermark, commands: [command, command] }));
  const first = await exporter.flush();
  assert.equal(first.commands, 1); assert.equal(first.pollMs, FAST_POLL_MS);
  assert.equal(getItem(f.c, 'item-1').state, 'cancelled');
  await exporter.flush(); // delivered again in the response to the batch that reports it
  assert.equal(getItem(f.c, 'item-1').resourceVersion, version + 1);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM coordination_command_log WHERE operation='CancelItem'").get().n, 1);
  assert.equal(log(f.c, 'cmd-1').actor, 'bob-user-1'); assert.equal(log(f.c, 'cmd-1').owner, 'edge-principal');
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  await exporter.flush();
  const reported = f.batches.flatMap(batch => batch.results ?? []);
  assert.equal(reported.length, 2);
  assert.deepEqual(reported[0], reported[1]);
  assert.equal(reported[0].ok, true); assert.equal(reported[0].commandId, 'cmd-1');
  assert.equal(reported[0].operation.state, 'succeeded'); assert.equal('error' in reported[0].operation, false);
});

test('results ride the next batch and are cleared only after it is accepted', async t => {
  const f = edgeFixture(t);
  const exporter = edgeExporter(f.options()); t.after(() => exporter.close());
  f.setReply(once([queued('cmd-pause', 'ControlPlan', { planId: f.planId, expectedVersion: 2, action: 'pause' })]));
  await exporter.flush();
  assert.equal(f.batches[0].results, undefined);
  f.setReply(() => ({ accepted: false }));
  await assert.rejects(exporter.flush(), /did not accept/);
  assert.equal(f.batches[1].kind, 'changes'); assert.equal(f.batches[1].results[0].commandId, 'cmd-pause');
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  assert.equal((await exporter.flush()).results, 1);
  assert.deepEqual(f.batches[2].results, f.batches[1].results);
  assert.equal(f.batches[2].results[0].operation.resourceId, f.planId);
  f.tick(31_000);
  await exporter.flush();
  assert.equal(f.batches[3].kind, 'heartbeat'); assert.equal(f.batches[3].results, undefined);
});

test('a new exporter on the same checkpoint re-reports pending results after a crash', async t => {
  const f = edgeFixture(t);
  let exporter = edgeExporter(f.options());
  f.setReply(once([queued('cmd-crash', 'CancelItem', { itemId: 'item-2', expectedVersion: getItem(f.c, 'item-2').resourceVersion })]));
  await exporter.flush(); exporter.close(); // crash before reporting
  exporter = edgeExporter(f.options()); t.after(() => exporter.close());
  await exporter.flush();
  assert.equal(f.batches[1].results.length, 1); assert.equal(f.batches[1].results[0].commandId, 'cmd-crash');
  assert.equal(f.batches[1].results[0].ok, true);
});

test('invalid, unknown and disallowed commands become error results', async t => {
  const f = edgeFixture(t);
  const exporter = edgeExporter(f.options({ commands: { operations: ['CancelItem', 'ReconcileItem'] } })); t.after(() => exporter.close());
  f.setReply(once([
    queued('cmd-unknown', 'DeletePlan', { planId: f.planId }),
    queued('cmd-bad-input', 'CancelItem', { itemId: 'item-1' }),
    queued('cmd-forbidden', 'ControlPlan', { planId: f.planId, expectedVersion: 2, action: 'pause' }),
    queued('cmd-missing', 'CancelItem', { itemId: 'nope', expectedVersion: 1 }),
    queued('cmd-stale', 'CancelItem', { itemId: 'item-1', expectedVersion: 99 }),
    queued('cmd-no-actor', 'ReconcileItem', { itemId: 'item-1' }, ''),
    { operation: 'CancelItem' }, 'garbage', null,
  ]));
  const result = await exporter.flush();
  assert.equal(result.commands, 6);
  await exporter.flush();
  const results = Object.fromEntries(f.batches[1].results.map(r => [r.commandId, r]));
  assert.deepEqual(Object.keys(results).sort(), ['cmd-bad-input', 'cmd-forbidden', 'cmd-missing', 'cmd-no-actor', 'cmd-stale', 'cmd-unknown']);
  assert.deepEqual(Object.fromEntries(Object.entries(results).map(([id, r]) => [id, [r.ok, r.error.code, r.error.retryable]])), {
    'cmd-unknown': [false, 'InvalidRequest', false], 'cmd-bad-input': [false, 'InvalidRequest', false], 'cmd-forbidden': [false, 'Forbidden', false],
    'cmd-missing': [false, 'NotFound', false], 'cmd-stale': [false, 'VersionConflict', false], 'cmd-no-actor': [false, 'InvalidRequest', false],
  });
  assert.equal(getItem(f.c, 'item-1').state, 'ready');
});

test('without a command channel every relayed command is refused', async t => {
  const f = edgeFixture(t);
  const exporter = edgeExporter(f.options({ commands: undefined })); t.after(() => exporter.close());
  f.setReply(once([queued('cmd-off', 'ReconcileItem', { itemId: 'item-1' })]));
  await exporter.flush(); await exporter.flush();
  assert.equal(f.batches[1].results[0].error.code, 'Forbidden');
});

test('a heartbeat carries results immediately, then fast polling engages and disengages', async t => {
  const f = edgeFixture(t);
  const exporter = edgeExporter(f.options()); t.after(() => exporter.close());
  await exporter.flush(); // snapshot
  f.tick(31_000);
  f.setReply(once([queued('cmd-reconcile', 'ReconcileItem', { itemId: 'item-1' })]));
  const heartbeat = await exporter.flush();
  assert.equal(heartbeat.kind, 'heartbeat'); assert.equal(heartbeat.pollMs, FAST_POLL_MS);
  // Pending result: the very next flush sends a heartbeat without waiting.
  const report = await exporter.flush();
  assert.equal(report.kind, 'heartbeat'); assert.equal(report.results, 1);
  assert.equal(f.batches.at(-1).results[0].error.code, 'InvalidTransition');
  // That response carried no commands: back to the 30 s heartbeat.
  assert.equal(report.pollMs, undefined);
  f.tick(FAST_POLL_MS);
  assert.deepEqual(await exporter.flush(), { kind: 'idle', sent: 0 });
  // The edge may ask for fast polling (a client is watching) with pollMs.
  f.tick(30_000); f.setReply(body => ({ accepted: true, watermark: body.watermark, pollMs: 2500 }));
  assert.equal((await exporter.flush()).pollMs, 2500);
  f.tick(1000); assert.deepEqual(await exporter.flush(), { kind: 'idle', sent: 0, pollMs: 2500 });
  f.tick(1500); assert.equal((await exporter.flush()).kind, 'heartbeat');
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  f.tick(2500); assert.equal((await exporter.flush()).pollMs, undefined);
  f.tick(2500); assert.equal((await exporter.flush()).kind, 'idle');
});

test('results that do not fit under the batch cap wait for a later batch', async t => {
  const f = edgeFixture(t);
  let exporter = edgeExporter(f.options());
  await exporter.flush();
  const heartbeatBytes = Buffer.byteLength(JSON.stringify({ contractVersion: '1', kind: 'heartbeat', watermark: f.batches[0].watermark, plans: [], items: [] }));
  f.tick(31_000);
  f.setReply(once([queued('cmd-a', 'ReconcileItem', { itemId: 'item-1' }), queued('cmd-b', 'ReconcileItem', { itemId: 'item-2' })]));
  await exporter.flush(); exporter.close();
  const pending = new DatabaseSync(f.checkpoint).prepare('SELECT result FROM edge_command_result ORDER BY command_id').all().map(row => row.result);
  const oneResult = heartbeatBytes + Buffer.byteLength(`,"results":[${pending[0]}]`);
  exporter = edgeExporter(f.options({ maxBytes: oneResult })); t.after(() => exporter.close());
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  await exporter.flush(); await exporter.flush();
  assert.deepEqual(f.batches.slice(-2).map(batch => batch.results.map(r => r.commandId)), [['cmd-a'], ['cmd-b']]);
  for (const batch of f.batches) assert(Buffer.byteLength(JSON.stringify(batch)) <= Math.max(oneResult, 1_000_000));
});

test('transient command failures are not reported; the edge re-delivery runs them later', async t => {
  const f = edgeFixture(t);
  const failures = [
    new Error('database is locked /var/lib/secret.sqlite'), // node:sqlite SQLITE_BUSY: not a CoordinationError
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
    new CoordinationError('KanbangerUnavailable', 'Kanbanger is unavailable', 503),
    Object.assign(new CoordinationError('KanbangerReadBackMismatch', 'read-back', 502), { retryable: true }),
    Object.assign(new CoordinationError('Flaky', 'marked retryable', 409), { retryable: true }),
  ];
  let calls = 0;
  const principal = { admit: async (...args) => { const failure = failures[calls++]; if (failure) throw failure; return f.c.admit(...args); } };
  const logged = [];
  const exporter = edgeExporter(f.options({ commands: { operations: [...RELAYED_OPERATIONS], coordinator: principal }, log: line => logged.push(line) })); t.after(() => exporter.close());
  const command = queued('cmd-transient', 'ControlPlan', { planId: f.planId, expectedVersion: 2, action: 'pause' });
  f.setReply(body => ({ accepted: true, watermark: body.watermark, commands: [command] })); // the edge re-sends until answered
  for (let i = 0; i < failures.length; i++) {
    f.tick(FAST_POLL_MS); // a real edge re-sends after REDELIVER_AFTER_MS (10 s); this fake re-sends every response
    const result = await exporter.flush();
    assert.equal(result.commands, undefined);
    assert.equal(f.batches.at(-1).results, undefined);
  }
  assert.deepEqual(logged.map(line => line.code), ['InternalError', 'InternalError', 'KanbangerUnavailable', 'KanbangerReadBackMismatch', 'Flaky']);
  assert(logged.every(line => line.outcome === 'command-transient' && !('message' in line)));
  f.tick(FAST_POLL_MS);
  assert.equal((await exporter.flush()).commands, 1); // now it runs
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  await exporter.flush();
  const [result] = f.batches.at(-1).results;
  assert.equal(result.ok, true); assert.equal(result.operation.state, 'succeeded');
});

test('only CoordinationError refusals reach the edge with their text; anything else is generic', () => {
  assert.deepEqual(classifyCommandError(new CoordinationError('VersionConflict', 'stale', 409)), { final: true, error: { code: 'VersionConflict', message: 'stale', retryable: false } });
  assert.deepEqual(classifyCommandError(new Error('SQLITE_BUSY at /secret')), { final: false, error: INTERNAL_ERROR });
  assert.deepEqual(classifyCommandError({ code: 'Forbidden', status: 403, message: 'looks like one' }), { final: false, error: INTERNAL_ERROR });
  assert.deepEqual(INTERNAL_ERROR, { code: 'InternalError', message: 'The coordinator could not run this command.', retryable: true });
  assert.equal(classifyCommandError(new CoordinationError('StorageVersion', 'x', 500)).final, false);
});

test('at most MAX_RESULTS_PER_BATCH results ride one batch', async t => {
  const f = edgeFixture(t);
  let exporter = edgeExporter(f.options()); await exporter.flush(); exporter.close();
  const db = new DatabaseSync(f.checkpoint);
  const [{ owner }] = db.prepare('SELECT owner FROM edge_command_result UNION SELECT owner FROM edge_checkpoint').all();
  const insert = db.prepare('INSERT INTO edge_command_result VALUES (?,?,?,?)');
  for (let i = 0; i < MAX_RESULTS_PER_BATCH + 7; i++) {
    const id = 'r' + String(i).padStart(4, '0');
    insert.run(owner, id, JSON.stringify({ commandId: id, ok: false, error: { code: 'X', message: 'm', retryable: false } }), i);
  }
  db.close();
  exporter = edgeExporter(f.options()); t.after(() => exporter.close());
  f.tick(31_000);
  assert.equal((await exporter.flush()).results, MAX_RESULTS_PER_BATCH);
  assert.equal((await exporter.flush()).results, 7);
  assert.equal(MAX_RESULTS_PER_BATCH, 500);
});

test('edge configuration validates the command principal allowlist', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bob-edge-commands-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, config) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(config)); return path; };
  const base = { endpoint: ENDPOINT, checkpoint: '/tmp/edge.sqlite', tokenEnv: 'BOB_SDLC_EDGE_TOKEN' };
  const env = { BOB_SDLC_EDGE_TOKEN: TOKEN };
  assert.deepEqual(loadEdgeConfig(write('ok.json', { ...base, commands: { operations: ['ControlPlan', 'CancelItem'] } }), env),
    { endpoint: ENDPOINT, checkpoint: '/tmp/edge.sqlite', token: TOKEN, commands: { operations: ['ControlPlan', 'CancelItem'] } });
  for (const commands of [{}, { operations: [] }, { operations: ['CreatePlan'] }, { operations: ['CancelItem', 'CancelItem'] }, { operations: ['CancelItem'], context: {} }, ['CancelItem']]) {
    assert.throws(() => loadEdgeConfig(write('bad.json', { ...base, commands }), env), /commands\.operations/);
  }
  assert.throws(() => edgeExporter({ coordinator: { db: { prepare: () => ({ all: () => [] }) } }, endpoint: ENDPOINT, token: TOKEN, checkpoint: join(dir, 'x.sqlite'), commands: { operations: ['RequestExecution'] } }), /Invalid edge configuration/);
});

test('the worker polls fast while the edge exporter asks for it, and idles otherwise', { timeout: 5000 }, async () => {
  const controller = new AbortController(); let flushes = 0;
  const started = Date.now();
  await runWorker({ coordinator: { dispatchOne: async () => ({ dispatched: false }) }, port: {}, intervalMs: 600_000, signal: controller.signal, random: () => 0.5, log: () => {},
    edge: { flush: async () => { if (++flushes === 3) controller.abort(); return { kind: 'heartbeat', sent: 0, pollMs: 20 }; } } });
  assert.equal(flushes, 3); assert(Date.now() - started < 2000);
  // Without pollMs the worker keeps its idle interval (the abort ends the long sleep).
  const idle = new AbortController(); let idleFlushes = 0;
  setTimeout(() => idle.abort(), 100);
  await runWorker({ coordinator: { dispatchOne: async () => ({ dispatched: false }) }, port: {}, intervalMs: 600_000, signal: idle.signal, random: () => 0.5, log: () => {},
    edge: { flush: async () => { idleFlushes++; return { kind: 'idle', sent: 0 }; } } });
  assert.equal(idleFlushes, 1);
});
