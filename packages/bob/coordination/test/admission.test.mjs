import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Coordinator, supportedOperations } from '../runtime/coordinator.mjs';

const target = { environmentId: 'hetzner-bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'gmacko', actorId: 'graham', targets: [target], issueProjects: [project] };
const request = (commandId = 'create-1', itemId = 'item-1') => ({ contractVersion: '1', commandId, plan: { items: [{ itemId, issue: { ...project, issueId: 'issue-43' }, target, issueSnapshotRef: 'snapshot-43', completionTarget: 'production' }], dependencies: [], concurrencyLimit: 2 } });
const query = resourceId => ({ contractVersion: '1', resourceId });
const command = (coordinator, name, body) => coordinator.call(name, body, { idempotencyKey: body.commandId });
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-admission-'));
  const database = join(dir, 'coordination.sqlite');
  let service = new Coordinator({ database, context, ...options });
  t.after(() => { service?.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, database, get service() { return service; }, reopen(nextContext = context) { service.close(); service = new Coordinator({ database, context: nextContext }); return service; } };
}
const code = expected => error => error.code === expected;
const api = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url)));
const ajv = new Ajv({ strict: false }); addFormats(ajv);
const outputs = new Map(Object.values(api.paths).flatMap(Object.values).filter(op => op.operationId).map(op => [op.operationId.split('/').at(-1), ajv.compile(op.responses['200'].content['application/json'].schema)]));
function response(name, value) { const validate = outputs.get(name); assert(validate(value), JSON.stringify(validate.errors)); return value; }

test('accepted plans, receipts and outbox survive restart; canonical replay is stable', t => {
  const f = fixture(t), body = request();
  const admitted = response('CreatePlan', command(f.service, 'CreatePlan', body));
  const notifications = f.service.pendingNotifications(); assert.equal(notifications.length, 2);
  f.reopen();
  const reordered = { plan: body.plan, commandId: body.commandId, contractVersion: '1' };
  assert.deepEqual(command(f.service, 'CreatePlan', reordered), admitted);
  assert.deepEqual(f.service.pendingNotifications(), notifications);
  assert.deepEqual(response('GetOperation', f.service.call('GetOperation', query(admitted.operationId))), admitted);
  const snapshot = response('GetPlan', f.service.call('GetPlan', query(admitted.resourceId)));
  assert.equal(snapshot.state, 'draft'); assert.equal(snapshot.items[0].state, 'pending');
  response('GetItem', f.service.call('GetItem', query('item-1')));
});
test('replay precedes stale expectedVersion checks and never duplicates events', t => {
  const f = fixture(t), created = command(f.service, 'CreatePlan', request());
  const start = { contractVersion: '1', commandId: 'start-1', planId: created.resourceId, expectedVersion: 1, action: 'start' };
  const started = response('ControlPlan', command(f.service, 'ControlPlan', start));
  command(f.service, 'ControlPlan', { ...start, commandId: 'pause-1', expectedVersion: 2, action: 'pause' });
  assert.deepEqual(command(f.service, 'ControlPlan', start), started);
  assert.equal(f.service.pendingNotifications().length, 6);
  assert.throws(() => command(f.service, 'ControlPlan', { ...start, commandId: 'start-2' }), code('VersionConflict'));
});
test('command namespace rejects changed payloads and changed operation names', t => {
  const f = fixture(t), body = request(), created = command(f.service, 'CreatePlan', body);
  assert.throws(() => command(f.service, 'CreatePlan', { ...body, plan: { ...body.plan, concurrencyLimit: 3 } }), code('IdempotencyConflict'));
  assert.throws(() => command(f.service, 'ControlPlan', { contractVersion: '1', commandId: body.commandId, planId: created.resourceId, expectedVersion: 1, action: 'start' }), code('IdempotencyConflict'));
});
for (const phase of ['after-state', 'before-commit']) test(`failure at ${phase} rolls back all state, receipt and outbox writes`, t => {
  const f = fixture(t, { fault: current => { if (current === phase) throw new Error('injected crash'); } });
  assert.throws(() => command(f.service, 'CreatePlan', request()), /injected crash/);
  assert.equal(f.service.pendingNotifications().length, 0);
  assert.equal(f.service.call('ReadEvents', { contractVersion: '1', limit: 100 }).events.length, 0);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM forge_receipt').get().n, 0);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 0);
  f.reopen(); assert.equal(command(f.service, 'CreatePlan', request()).resourceVersion, 1);
});
test('trusted identity and current policy fence plans, receipts and event cursors', t => {
  const f = fixture(t), body = request(), created = command(f.service, 'CreatePlan', body);
  const cursor = f.service.call('GetPlan', query(created.resourceId)).eventCursor;
  f.reopen({ ...context, actorId: 'another' });
  for (const [name, id] of [['GetPlan', created.resourceId], ['GetItem', 'item-1'], ['GetOperation', created.operationId]]) assert.throws(() => f.service.call(name, query(id)), code('NotFound'));
  assert.throws(() => f.service.call('ReadEvents', { contractVersion: '1', cursor, limit: 10 }), code('CursorExpired'));
  assert.equal(command(f.service, 'CreatePlan', request('create-1', 'item-2')).resourceVersion, 1);
  f.reopen({ ...context, workspaceId: 'another-workspace' });
  assert.throws(() => f.service.call('GetPlan', query(created.resourceId)), code('NotFound'));
  assert.throws(() => command(f.service, 'CreatePlan', body), code('Forbidden'));
  f.reopen({ ...context, targets: [] });
  assert.throws(() => command(f.service, 'CreatePlan', body), code('Forbidden'));
  assert.throws(() => f.service.call('GetPlan', query(created.resourceId)), code('Forbidden'));
  assert.throws(() => f.service.call('ReadEvents', { contractVersion: '1', limit: 10 }), code('Forbidden'));
});
test('DAG checks reject cycles, missing endpoints, duplicate IDs and impossible milestones atomically', t => {
  const f = fixture(t), base = request();
  const second = { ...base.plan.items[0], itemId: 'item-2', completionTarget: 'execution' };
  const items = [...base.plan.items, second];
  const edge = { upstreamItemId: 'item-1', downstreamItemId: 'item-2', requiredMilestone: 'production-verified' };
  const cases = [
    { ...base.plan, items: [items[0], items[0]] },
    { ...base.plan, items, dependencies: [{ ...edge, downstreamItemId: 'absent' }] },
    { ...base.plan, items, dependencies: [edge, { upstreamItemId: 'item-2', downstreamItemId: 'item-1', requiredMilestone: 'execution-succeeded' }] },
    { ...base.plan, items, dependencies: [{ upstreamItemId: 'item-2', downstreamItemId: 'item-1', requiredMilestone: 'merged' }] },
  ];
  for (const plan of cases) assert.throws(() => command(f.service, 'CreatePlan', { ...base, plan }), code('InvalidGraph'));
  assert.equal(f.service.pendingNotifications().length, 0);
  const created = command(f.service, 'CreatePlan', { ...base, plan: { ...base.plan, items, dependencies: [edge] } });
  command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: created.resourceId, expectedVersion: 1, action: 'start' });
  const snapshot = response('GetPlan', f.service.call('GetPlan', query(created.resourceId)));
  assert.deepEqual(snapshot.items.map(item => item.state), ['ready', 'pending']);
});
test('schema, key equality and target policy reject before writing', t => {
  const f = fixture(t), body = request();
  assert.throws(() => f.service.call('CreatePlan', body), code('InvalidRequest'));
  assert.throws(() => command(f.service, 'CreatePlan', { ...body, apiKey: 'fixture' }), code('InvalidRequest'));
  assert.throws(() => command(f.service, 'CreatePlan', { ...body, plan: { ...body.plan, items: [{ ...body.plan.items[0], target: { ...target, environmentId: 'gmacko-mini' } }] } }), code('Forbidden'));
  assert.equal(f.service.pendingNotifications().length, 0);
});
test('snapshot watermark resumes bounded pages without skipping committed changes', t => {
  const f = fixture(t), created = command(f.service, 'CreatePlan', request());
  const snapshot = f.service.call('GetPlan', query(created.resourceId));
  command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: created.resourceId, expectedVersion: 1, action: 'start' });
  const first = response('ReadEvents', f.service.call('ReadEvents', { contractVersion: '1', cursor: snapshot.eventCursor, limit: 1 }));
  const second = response('ReadEvents', f.service.call('ReadEvents', { contractVersion: '1', cursor: first.nextCursor, limit: 1 }));
  const empty = f.service.call('ReadEvents', { contractVersion: '1', cursor: second.nextCursor, limit: 1 });
  assert.equal(first.events.length, 1); assert.equal(second.events.length, 1); assert.equal(empty.events.length, 0);
  assert(first.events[0].sequence < second.events[0].sequence);
  assert.equal(f.service.call('GetCapabilities', { contractVersion: '1' }).operations.length, supportedOperations.length);
  assert.throws(() => f.service.call('SubmitExecution', {}), code('CapabilityUnavailable'));
});
test('draft edits are versioned; active edits and item removal are rejected', t => {
  const f = fixture(t), body = request(), created = command(f.service, 'CreatePlan', body);
  const update = { contractVersion: '1', commandId: 'update', planId: created.resourceId, expectedVersion: 1, plan: { ...body.plan, concurrencyLimit: 4 } };
  response('UpdatePlan', command(f.service, 'UpdatePlan', update));
  command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: created.resourceId, expectedVersion: 2, action: 'start' });
  assert.throws(() => command(f.service, 'UpdatePlan', { ...update, commandId: 'edit-active', expectedVersion: 3 }), code('InvalidTransition'));
  command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'pause', planId: created.resourceId, expectedVersion: 3, action: 'pause' });
  assert.throws(() => command(f.service, 'UpdatePlan', { ...update, commandId: 'remove', expectedVersion: 4, plan: request('x', 'replacement').plan }), code('InvalidGraph'));
  assert.equal(f.service.call('GetPlan', query(created.resourceId)).resourceVersion, 4);
});
const cli = fileURLToPath(new URL('../runtime/cli.mjs', import.meta.url));
function cliArgs(f, name, body, suffix) {
  const config = join(f.dir, 'context.json'), input = join(f.dir, `input-${suffix}.json`);
  writeFileSync(config, JSON.stringify(context)); writeFileSync(input, JSON.stringify(body));
  return [cli, name, '--database', f.database, '--context', config, '--input', input];
}
test('CLI opens the real store and replays after separate process restarts', t => {
  const f = fixture(t), args = cliArgs(f, 'CreatePlan', request(), 'create');
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr);
  const second = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
  const get = spawnSync(process.execPath, cliArgs(f, 'GetPlan', query(JSON.parse(first.stdout).resourceId), 'get'), { encoding: 'utf8' });
  assert.equal(get.status, 0, get.stderr); response('GetPlan', JSON.parse(get.stdout));
});
test('concurrent processes serialize expectedVersion updates', async t => {
  const f = fixture(t), body = request(), created = command(f.service, 'CreatePlan', body);
  const update = { contractVersion: '1', planId: created.resourceId, expectedVersion: 1, plan: body.plan };
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, args); let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all(['a', 'b'].map(commandId => run(cliArgs(f, 'UpdatePlan', { ...update, commandId }, commandId))));
  assert.deepEqual(results.map(result => result.status).sort(), [0, 1]);
  assert.match(results.find(result => result.status === 1).stderr, /VersionConflict/);
  assert.equal(f.service.call('GetPlan', query(created.resourceId)).resourceVersion, 2);
  assert.equal(f.service.pendingNotifications().length, 4);
});

test('an abrupt process exit before commit leaves no partial admission on restart', t => {
  const f = fixture(t);
  const moduleUrl = new URL('../runtime/coordinator.mjs', import.meta.url).href;
  const script = `import { Coordinator } from ${JSON.stringify(moduleUrl)};
    const coordinator = new Coordinator({ database: ${JSON.stringify(f.database)}, context: ${JSON.stringify(context)}, fault: phase => { if (phase === 'before-commit') process.exit(99); } });
    coordinator.call('CreatePlan', ${JSON.stringify(request())}, { idempotencyKey: 'create-1' });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(child.status, 99, child.stderr);
  f.reopen();
  assert.equal(f.service.pendingNotifications().length, 0);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM forge_receipt').get().n, 0);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 0);
  command(f.service, 'CreatePlan', request());
  assert.equal(f.service.pendingNotifications().length, 2);
});
test('a cancelled plan cannot restart and target policy also fences pending notifications', t => {
  const f = fixture(t), created = command(f.service, 'CreatePlan', request());
  command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'cancel', planId: created.resourceId, expectedVersion: 1, action: 'cancel' });
  assert.equal(f.service.call('GetItem', query('item-1')).item.state, 'cancelled');
  assert.throws(() => command(f.service, 'ControlPlan', { contractVersion: '1', commandId: 'restart', planId: created.resourceId, expectedVersion: 2, action: 'start' }), code('InvalidTransition'));
  f.reopen({ ...context, targets: [] });
  assert.throws(() => f.service.pendingNotifications(), code('Forbidden'));
});
