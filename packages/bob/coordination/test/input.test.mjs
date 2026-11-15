import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionCoordinator, evidenceWithCommit } from '../runtime/execution.mjs';
import { outputValidators, storageVersion } from '../runtime/coordinator.mjs';
import { edgeExporter } from '../runtime/edge.mjs';
import { decodeAnswers, inputCommandId } from '../runtime/input.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'edge-principal', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob' };
const item = itemId => ({ itemId, issue: { ...project, issueId: itemId }, issueSnapshotRef: 'snapshot', target, completionTarget: 'execution' });
const call = (c, name, body, extra = {}) => c.call(name, { contractVersion: '1', ...body }, { idempotencyKey: body.commandId ?? body.requestId, ...extra });
const code = expected => error => error.code === expected;
const getItem = (c, id) => c.call('GetItem', { contractVersion: '1', resourceId: id }).item;
const request = (planId, suffix = '1', itemId = 'item-1') => ({ requestId: 'request-' + suffix, attemptId: 'attempt-' + suffix, itemId, planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-80' }, executionProfileId: 'pistache' });
const admission = r => ({ contractVersion: '1', requestId: r.requestId, executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, target: r.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-' + r.attemptId } });
const receipt = (r, outcome = 'failed', evidenceRefs = ['log']) => ({ contractVersion: '1', eventId: 'event-' + r.attemptId, environmentId: 'bob', executionId: admission(r).executionId, attemptId: r.attemptId, sequence: 1, occurredAt: '2026-11-15T12:00:00Z', outcome, thread: admission(r).thread, sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs });
const port = { requireCapabilities: async () => {}, submit: async r => admission(r), find: async () => null };
const logRows = (c, id) => c.db.prepare('SELECT * FROM coordination_command_log WHERE command_id=? ORDER BY created_at, rowid').all(id);
const questions = [
  { id: 'q1', header: 'Target', question: 'Which stage?', options: [{ label: 'Staging', value: 'staging' }, { label: 'Production' }], multiSelect: false },
  { id: 'q2', question: 'Which checks?', options: [{ label: 'Unit' }, { label: 'E2E' }], multiSelect: true },
];
const pending = (attemptId = 'attempt-1', promptId = 'rr-1') => ({ attemptId, promptId, kind: 'user_input', questions, createdAt: '2026-11-15T10:00:00.000Z' });
const answer = JSON.stringify({ q1: 'staging', q2: 'Unit' });
const resolve = (c, commandId, body = {}, extra = {}) => call(c, 'ResolveInput', { commandId, attemptId: 'attempt-1', promptId: 'rr-1', answer, ...body }, extra);

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-input-')), database = join(dir, 'store.sqlite');
  const c = new ExecutionCoordinator({ database, context });
  const plan = call(c, 'CreatePlan', { commandId: 'create', plan: { items: [item('item-1'), item('item-2')], dependencies: [], concurrencyLimit: 2 } });
  call(c, 'ControlPlan', { commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  const body = request(plan.resourceId); call(c, 'RequestExecution', body);
  await c.dispatchOne(port);
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { c, dir, database, planId: plan.resourceId, body };
}

test('decodeAnswers matches the shared attempt.ts semantics', () => {
  const p = pending();
  assert.deepEqual(decodeAnswers(answer, p), { q1: 'staging', q2: 'Unit' });
  assert.deepEqual(decodeAnswers('{"q1":"free text","q2":["Unit","E2E"]}', p), { q1: 'free text', q2: ['Unit', 'E2E'] });
  for (const bad of ['nope', '[]', 'null', '{"q1":"a"}', '{"q1":"a","q2":"b","q3":"c"}', '{"q1":["a"],"q2":"b"}', '{"q1":"","q2":"b"}', '{"q1":"a","q2":[]}', JSON.stringify({ q1: 'x'.repeat(4001), q2: 'b' }), '{"q1":1,"q2":"b"}']) {
    assert.equal(decodeAnswers(bad, p), null, bad);
  }
});

test('recordPendingInput: running → waiting-input, idempotent per promptId, a new prompt replaces it, clear returns to running', async t => {
  const { c } = await setup(t);
  assert.equal(getItem(c, 'item-1').state, 'running');
  assert.deepEqual(c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() }), { changed: true });
  const waiting = getItem(c, 'item-1');
  assert.equal(waiting.state, 'waiting-input'); assert.equal(waiting.pendingInput.promptId, 'rr-1');
  assert(outputValidators.get('GetItem')({ contractVersion: '1', item: waiting, eventCursor: 'x' }));
  assert.deepEqual(c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() }), { changed: false, reason: 'unchanged' });
  assert.equal(getItem(c, 'item-1').resourceVersion, waiting.resourceVersion);
  assert.deepEqual(c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending('attempt-1', 'rr-2') }), { changed: true });
  assert.equal(getItem(c, 'item-1').pendingInput.promptId, 'rr-2');
  assert.deepEqual(c.clearPendingInput({ attemptId: 'attempt-1', promptId: 'rr-1' }), { changed: false }); // not the waiting prompt
  assert.deepEqual(c.clearPendingInput({ attemptId: 'attempt-1', promptId: 'rr-2' }), { changed: true });
  const running = getItem(c, 'item-1');
  assert.equal(running.state, 'running'); assert.equal('pendingInput' in running, false);
  // Only the item's current running attempt; malformed input is refused.
  assert.throws(() => c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending('attempt-2') }), code('InvalidRequest'));
  assert.throws(() => c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: { ...pending(), kind: 'permission' } }), code('InvalidRequest'));
  assert.throws(() => c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: { ...pending(), questions: [] } }), code('InvalidRequest'));
  assert.throws(() => c.recordPendingInput({ attemptId: 'attempt-9', pendingInput: pending('attempt-9') }), code('NotFound'));
});

test('ResolveInput: validates, returns the item to running, queues the t3 answer and logs the actor', async t => {
  const { c } = await setup(t);
  assert(c.call('GetCapabilities', { contractVersion: '1' }).operations.includes('ResolveInput'));
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  const op = resolve(c, 'answer-1', {}, { actor: 'bob-user-7' });
  assert.equal(op.state, 'accepted'); assert.equal(op.resourceId, 'item-1');
  const after = getItem(c, 'item-1');
  assert.equal(after.state, 'running'); assert.equal('pendingInput' in after, false); assert(after.operationIds.includes(op.operationId));
  const [row] = logRows(c, 'answer-1');
  assert.deepEqual([row.operation, row.actor, row.outcome, row.resource_id, row.owner], ['ResolveInput', 'bob-user-7', 'accepted', 'item-1', 'edge-principal']);
  const [delivery] = c.pendingInputDeliveries();
  assert.deepEqual(delivery.answers, { q1: 'staging', q2: ['Unit'] }); // multiSelect is an array on the t3 wire
  assert.equal(delivery.threadId, 'thread-attempt-1'); assert.equal(delivery.t3CommandId, inputCommandId('attempt-1', 'rr-1')); assert.equal(delivery.live, true);
  // An answered prompt that t3 still shows pending is never re-recorded.
  assert.deepEqual(c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() }), { changed: false, reason: 'answered' });
  // Settling: the Operation succeeds, the answer text is erased, a completion row keeps the actor.
  assert.deepEqual(c.settleInputDelivery(delivery.id, 'delivered'), { changed: true });
  assert.deepEqual(c.settleInputDelivery(delivery.id, 'delivered'), { changed: false });
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state, 'succeeded');
  assert.equal(c.db.prepare('SELECT answers FROM coordination_input_delivery WHERE id=?').get(delivery.id).answers, null);
  assert.deepEqual(logRows(c, 'answer-1').map(r => [r.outcome, r.actor]), [['accepted', 'bob-user-7'], ['succeeded', 'bob-user-7']]);
  assert.deepEqual(c.pendingInputDeliveries(), []);
});

test('ResolveInput refuses a wrong prompt, a bad answer, a state other than waiting-input and a stale attempt', async t => {
  const { c, body } = await setup(t);
  assert.throws(() => resolve(c, 'early'), code('InvalidTransition')); // running, not waiting
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  assert.throws(() => resolve(c, 'wrong-prompt', { promptId: 'rr-0' }, { actor: 'bob-user-7' }), code('InvalidTransition'));
  assert.equal(logRows(c, 'wrong-prompt')[0].outcome, 'InvalidTransition'); assert.equal(logRows(c, 'wrong-prompt')[0].actor, 'bob-user-7');
  assert.throws(() => resolve(c, 'bad-answer', { answer: '{"q1":"staging"}' }), code('InvalidRequest'));
  assert.throws(() => resolve(c, 'other-item', {}, { expectItemId: 'item-2' }), code('InvalidTransition'));
  assert.throws(() => resolve(c, 'no-attempt', { attemptId: 'attempt-9' }), code('NotFound'));
  assert.equal(getItem(c, 'item-1').state, 'waiting-input');
  // The attempt ends while the question is open: pendingInput goes with it and answers are stale.
  c.call('RecordExecutionReceipt', receipt(body, 'failed'));
  const failed = getItem(c, 'item-1');
  assert.equal(failed.state, 'failed'); assert.equal('pendingInput' in failed, false);
  assert.throws(() => resolve(c, 'stale'), code('InvalidTransition'));
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_input_delivery').get().n, 0);
});

test('ResolveInput replays idempotently and a reused commandId with another answer conflicts', async t => {
  const { c } = await setup(t);
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  const first = resolve(c, 'answer-1', {}, { actor: 'bob-user-7' });
  const version = getItem(c, 'item-1').resourceVersion;
  assert.deepEqual(resolve(c, 'answer-1', {}, { actor: 'bob-user-7' }), first);
  assert.equal(getItem(c, 'item-1').resourceVersion, version);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM coordination_input_delivery').get().n, 1);
  assert.equal(logRows(c, 'answer-1').length, 1);
  assert.throws(() => resolve(c, 'answer-1', { answer: JSON.stringify({ q1: 'Production', q2: 'E2E' }) }), code('IdempotencyConflict'));
  // A delivery for an attempt that ended is abandoned and its Operation fails.
  const [delivery] = c.pendingInputDeliveries();
  c.settleInputDelivery(delivery.id, 'abandoned', 'resolved-elsewhere');
  const op = c.call('GetOperation', { contractVersion: '1', resourceId: first.operationId });
  assert.equal(op.state, 'failed'); assert.equal(op.error.code, 'InputNotDelivered');
  assert.equal(logRows(c, 'answer-1').at(-1).outcome, 'failed');
});

test('a failed delivery backs off and keeps only an error code', async t => {
  const { c } = await setup(t);
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  resolve(c, 'answer-1');
  const [delivery] = c.pendingInputDeliveries({ now: 1000 });
  c.deferInputDelivery(delivery.id, { now: 1000, code: 'Disconnected' });
  assert.deepEqual(c.pendingInputDeliveries({ now: 1500 }), []);
  assert.equal(c.pendingInputDeliveries({ now: 2000 })[0].deliveryAttempts, 1);
  assert.equal(c.db.prepare('SELECT last_error FROM coordination_input_delivery').get().last_error, 'Disconnected');
});

test('liveAttempts lists running and waiting-input attempts with their thread and target', async t => {
  const { c } = await setup(t);
  assert.deepEqual(c.liveAttempts().map(a => [a.attemptId, a.state, a.thread.threadId, a.promptId]), [['attempt-1', 'running', 'thread-attempt-1', null]]);
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  assert.deepEqual(c.liveAttempts().map(a => [a.state, a.promptId]), [['waiting-input', 'rr-1']]);
  call(c, 'CancelItem', { commandId: 'cancel', itemId: 'item-1', expectedVersion: getItem(c, 'item-1').resourceVersion });
  assert.equal(getItem(c, 'item-1').state, 'cancelling'); assert.equal('pendingInput' in getItem(c, 'item-1'), false);
  assert.deepEqual(c.liveAttempts(), []);
});

test('an execution receipt adds commit:<sha> to the item evidence, deduplicated and within 100 refs', async t => {
  const { c, body } = await setup(t);
  c.call('RecordExecutionReceipt', receipt(body, 'succeeded', ['log', `commit:${'b'.repeat(40)}`]));
  const done = getItem(c, 'item-1');
  assert.deepEqual(done.evidenceRefs, ['log', `commit:${'b'.repeat(40)}`]);
  assert(outputValidators.get('GetItem')({ contractVersion: '1', item: done, eventCursor: 'x' }));
  const full = Array.from({ length: 100 }, (_, i) => `ref-${i}`);
  const refs = evidenceWithCommit(full, 'd'.repeat(40));
  assert.equal(refs.length, 100); assert.equal(refs.at(-1), `commit:${'d'.repeat(40)}`); assert.equal(refs[0], 'ref-1');
  assert.deepEqual(evidenceWithCommit(['a'], 'not-a-sha'), ['a']);
});

test('the edge exporter relays ResolveInput without itemId and checks it names the attempt item', async t => {
  const { c, dir } = await setup(t);
  c.recordPendingInput({ attemptId: 'attempt-1', pendingInput: pending() });
  const command = (commandId, itemId) => ({ commandId, actor: 'bob-user-3', queuedAt: 1, operation: 'ResolveInput', input: { itemId, attemptId: 'attempt-1', promptId: 'rr-1', answer } });
  const batches = []; let commands = [command('relay-wrong', 'item-2'), command('relay-1', 'item-1')];
  const fetch = async (_url, req) => { const body = JSON.parse(req.body); batches.push(body); const reply = { accepted: true, watermark: body.watermark, commands }; commands = []; return Response.json(reply); };
  const exporter = edgeExporter({ coordinator: c, endpoint: 'https://bob.test/api/sdlc/ingest', token: 't'.repeat(40), checkpoint: join(dir, 'edge.sqlite'), fetch, commands: { operations: ['ResolveInput'] } });
  t.after(() => exporter.close());
  await exporter.flush(); await exporter.flush();
  const results = Object.fromEntries(batches.flatMap(b => b.results ?? []).map(r => [r.commandId, r]));
  assert.equal(results['relay-wrong'].ok, false); assert.equal(results['relay-wrong'].error.code, 'InvalidTransition');
  assert.equal(results['relay-1'].ok, true); assert.equal(results['relay-1'].operation.state, 'accepted');
  assert.equal(logRows(c, 'relay-1')[0].actor, 'bob-user-3');
  assert.equal(getItem(c, 'item-1').state, 'running');
});

test('a version-four store gains the input delivery table; the README rollback reverses it', async t => {
  const { c, database } = await setup(t);
  // Exactly the rollback in deploy/coordination/README.md ("Storage version 5 rollback").
  c.db.exec('BEGIN; DROP TABLE coordination_input_delivery; PRAGMA user_version = 4; COMMIT;');
  assert.deepEqual(c.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'coordination_input_delivery%'").all(), []);
  assert.equal(c.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const reopened = new ExecutionCoordinator({ database, context }); t.after(() => reopened.close());
  assert.equal(storageVersion, 5);
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.deepEqual(reopened.db.prepare('PRAGMA index_list(coordination_input_delivery)').all().map(ix => ix.name).filter(n => !n.startsWith('sqlite_')).sort(),
    ['coordination_input_delivery_ix_by_owner_status_next_attempt_at', 'coordination_input_delivery_uq_attemptId_promptId']);
});
