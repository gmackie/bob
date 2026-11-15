import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { outputValidators } from '../runtime/coordinator.mjs';
import { edgeExporter, loadEdgeConfig, FAST_POLL_MS, RELAYED_OPERATIONS } from '../runtime/edge.mjs';
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
const log = (c, id) => c.db.prepare('SELECT * FROM coordination_command_log WHERE id=?').get(id);

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
  // The same commandId can still succeed later, and the log row then records the effect.
  const op = cancel(c, 'cancel-stale', 'item-1', version);
  assert.equal(log(c, 'cancel-stale').operation_id, op.operationId);
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
  c.db.exec('DROP TABLE coordination_command_log; PRAGMA user_version = 3');
  const reopened = new ExecutionCoordinator({ database, context }); t.after(() => reopened.close());
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM coordination_command_log').get().n, 0);
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
