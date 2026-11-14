import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../runtime/coordinator.mjs';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { edgeExporter, loadEdgeConfig, MAX_BATCH_BYTES } from '../runtime/edge.mjs';

const target = { environmentId: 'hetzner-bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const retired = { environmentId: 'hetzner-old', projectId: 'old', repository: { integrationId: 'forgegraph', repositoryId: 'old' } };
const project = { integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'gmacko', actorId: 'graham', targets: [target], issueProjects: [project] };
const TOKEN = 't'.repeat(40), ENDPOINT = 'https://bob.test/api/sdlc/ingest';
const create = (c, commandId, itemId, itemTarget = target) => c.call('CreatePlan', { contractVersion: '1', commandId, plan: { items: [{ itemId, issue: { ...project, issueId: `issue-${itemId}` }, target: itemTarget, issueSnapshotRef: `snap-${itemId}`, completionTarget: 'production' }], dependencies: [], concurrencyLimit: 2 } }, { idempotencyKey: commandId });
const control = (c, commandId, planId, expectedVersion, action) => c.call('ControlPlan', { contractVersion: '1', commandId, planId, expectedVersion, action }, { idempotencyKey: commandId });

function fixture(t, { Klass = Coordinator, context: initial = context } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-edge-'));
  const database = join(dir, 'coordination.sqlite'), checkpoint = join(dir, 'edge.sqlite');
  let coordinator = new Klass({ database, context: initial });
  const batches = [];
  let calls = 0;
  let reply = body => ({ accepted: true, watermark: body.watermark });
  let clock = 1_000;
  const fetch = async (url, request) => {
    calls++;
    assert.equal(coordinator.db.isTransaction, false, 'the read transaction must close before the POST');
    assert.equal(url, ENDPOINT); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(request.body); batches.push(body);
    const answer = reply(body);
    return answer instanceof Response ? answer : Response.json(answer);
  };
  t.after(() => { coordinator.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get coordinator() { return coordinator; }, batches, checkpoint, get calls() { return calls; },
    get options() { return { coordinator, endpoint: ENDPOINT, token: TOKEN, checkpoint, fetch, now: () => clock }; },
    reopen: next => { coordinator.close(); coordinator = new Klass({ database, context: next }); },
    setReply: fn => { reply = fn; }, tick: ms => { clock += ms; },
  };
}

test('first flush sends a full snapshot and checkpoints its watermark', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options);
  assert.deepEqual(await exporter.flush(), { kind: 'snapshot', sent: 2 });
  const [batch] = f.batches;
  assert.equal(batch.contractVersion, '1');
  assert.equal(batch.plans.length, 1); assert.equal(batch.items[0].itemId, 'item-1');
  assert.equal(batch.watermark, f.coordinator.watermark());
  assert.deepEqual(await exporter.flush(), { kind: 'idle', sent: 0 });
  exporter.close();
});

test('later flushes send only changed resources, once each, from the checkpoint', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options); await exporter.flush();
  const planId = f.batches[0].plans[0].planId;
  f.coordinator.call('ControlPlan', { contractVersion: '1', commandId: 'c2', planId, expectedVersion: 1, action: 'start' }, { idempotencyKey: 'c2' });
  assert.deepEqual(await exporter.flush(), { kind: 'changes', sent: 2 });
  const batch = f.batches[1];
  assert.equal(batch.fromSequence, f.batches[0].watermark);
  assert.equal(batch.plans[0].state, 'active');
  assert.equal(batch.items[0].state, 'ready');
  exporter.close();
});

test('a restarted exporter resends a rejected batch unchanged', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  f.setReply(() => ({ accepted: false }));
  let exporter = edgeExporter(f.options);
  await assert.rejects(exporter.flush(), /did not accept/); exporter.close();
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  exporter = edgeExporter(f.options); await exporter.flush();
  assert.deepEqual(f.batches[0], f.batches[1]);
  exporter.close();
});

test('idle exporters send heartbeats, and the edge can demand a fresh snapshot', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options); await exporter.flush();
  f.tick(31_000);
  assert.deepEqual(await exporter.flush(), { kind: 'heartbeat', sent: 0 });
  f.setReply(() => ({ accepted: false, resync: true })); f.tick(31_000);
  await assert.rejects(exporter.flush(), /snapshot/);
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  assert.equal((await exporter.flush()).kind, 'snapshot');
  exporter.close();
});

test('unsafe configuration is refused', t => {
  const f = fixture(t);
  for (const endpoint of ['http://bob.test/api/sdlc/ingest', 'https://u:p@bob.test/api/sdlc/ingest', 'https://bob.test/api/sdlc/ingest?x=1', 'https://bob.test/api/sdlc/ingest#frag', 'https://bob.test/other']) {
    assert.throws(() => edgeExporter({ ...f.options, endpoint }), /HTTPS \/api\/sdlc\/ingest endpoint/);
  }
  assert.throws(() => edgeExporter({ ...f.options, token: 'short' }), /Invalid edge configuration/);
  assert.throws(() => edgeExporter({ ...f.options, token: undefined }), /Invalid edge configuration/);
  assert.throws(() => edgeExporter({ ...f.options, checkpoint: ':memory:' }), /Invalid edge configuration/);
  assert.throws(() => edgeExporter({ ...f.options, checkpoint: undefined }), /Invalid edge configuration/);
  assert.throws(() => edgeExporter({ ...f.options, checkpoint: f.coordinator.db.prepare('PRAGMA database_list').get().file }), /separate database/);
});

test('plans outside the trusted policy are skipped in snapshots', async t => {
  const f = fixture(t, { context: { ...context, targets: [target, retired] } });
  create(f.coordinator, 'c1', 'item-old', retired);
  f.reopen(context);
  create(f.coordinator, 'c2', 'item-new');
  const exporter = edgeExporter(f.options);
  assert.deepEqual(await exporter.flush(), { kind: 'snapshot', sent: 2 });
  const [batch] = f.batches;
  assert.deepEqual(batch.items.map(item => item.itemId), ['item-new']);
  assert.equal(batch.plans.length, 1); assert.equal(batch.plans[0].definition.items[0].itemId, 'item-new');
  assert.equal(batch.watermark, f.coordinator.watermark());
  exporter.close();
});

test('changes skip resources outside the trusted policy but still advance the watermark', async t => {
  const wide = { ...context, targets: [target, retired] };
  const f = fixture(t, { context: wide });
  create(f.coordinator, 'c1', 'item-1');
  let exporter = edgeExporter(f.options); await exporter.flush(); exporter.close();
  create(f.coordinator, 'c2', 'item-old', retired);
  f.reopen(context);
  create(f.coordinator, 'c3', 'item-new');
  exporter = edgeExporter(f.options);
  assert.deepEqual(await exporter.flush(), { kind: 'changes', sent: 2 });
  const batch = f.batches[1];
  assert.deepEqual(batch.items.map(item => item.itemId), ['item-new']);
  assert.equal(batch.plans.length, 1); assert.equal(batch.plans[0].definition.items[0].itemId, 'item-new');
  assert.equal(batch.watermark, f.coordinator.watermark());
  assert.deepEqual(await exporter.flush(), { kind: 'idle', sent: 0 });
  exporter.close();
});

test('snapshots leave out terminal plans and their items', async t => {
  const f = fixture(t);
  const cancelled = create(f.coordinator, 'c1', 'item-gone');
  control(f.coordinator, 'c2', cancelled.resourceId, 1, 'cancel');
  create(f.coordinator, 'c3', 'item-live');
  const exporter = edgeExporter(f.options);
  assert.deepEqual(await exporter.flush(), { kind: 'snapshot', sent: 2 });
  const [batch] = f.batches;
  assert.deepEqual(batch.items.map(item => item.itemId), ['item-live']);
  assert(!batch.plans.some(plan => plan.planId === cancelled.resourceId));
  exporter.close();
});

test('batches are capped at the edge ingest limit of 1,000,000 bytes', () => {
  assert.equal(MAX_BATCH_BYTES, 1_000_000);
});

test('an oversized batch is refused before it is sent and keeps the checkpoint', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  let exporter = edgeExporter({ ...f.options, maxBytes: 64 });
  const error = await exporter.flush().then(() => null, error => error);
  assert.match(error.message, /^Edge batch too large: \d+ bytes$/);
  assert(!error.message.includes(TOKEN));
  assert.equal(f.calls, 0); exporter.close();
  exporter = edgeExporter(f.options);
  assert.equal((await exporter.flush()).kind, 'snapshot');
  exporter.close();
});

test('an expired checkpoint falls back to a fresh snapshot', async t => {
  const f = fixture(t); create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options); await exporter.flush();
  const db = new DatabaseSync(f.checkpoint);
  db.prepare('UPDATE edge_checkpoint SET position=?').run(f.coordinator.watermark() + 1000); db.close();
  assert.deepEqual(await exporter.flush(), { kind: 'snapshot', sent: 2 });
  assert.equal(f.batches[1].watermark, f.coordinator.watermark());
  exporter.close();
});

test('repeated changes to the same resources are sent once each', async t => {
  const f = fixture(t); const { resourceId: planId } = create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options); await exporter.flush();
  const before = f.coordinator.watermark();
  control(f.coordinator, 'c2', planId, 1, 'start'); control(f.coordinator, 'c3', planId, 2, 'pause'); control(f.coordinator, 'c4', planId, 3, 'resume');
  assert.equal(f.coordinator.watermark() - before, 6);
  assert.deepEqual(await exporter.flush(), { kind: 'changes', sent: 2 });
  assert.equal(f.batches.length, 2);
  assert.equal(f.batches[1].plans[0].state, 'active'); assert.equal(f.batches[1].plans[0].resourceVersion, 4);
  exporter.close();
});

test('the exporter works with the ExecutionCoordinator the worker runs', async t => {
  const f = fixture(t, { Klass: ExecutionCoordinator }); create(f.coordinator, 'c1', 'item-1');
  assert(f.coordinator instanceof ExecutionCoordinator);
  const exporter = edgeExporter(f.options);
  assert.deepEqual(await exporter.flush(), { kind: 'snapshot', sent: 2 });
  assert.equal(f.batches[0].items[0].itemId, 'item-1');
  exporter.close();
});

test('flushing never changes coordination state', async t => {
  const f = fixture(t); const { resourceId: planId } = create(f.coordinator, 'c1', 'item-1');
  const state = () => ({
    watermark: f.coordinator.watermark(),
    outbox: f.coordinator.db.prepare('SELECT COUNT(*) AS n FROM forge_outbox').get().n,
    items: f.coordinator.db.prepare('SELECT * FROM coordination_item ORDER BY tenant, id').all(),
    plans: f.coordinator.db.prepare('SELECT * FROM coordination_plan ORDER BY tenant, id').all(),
  });
  const exporter = edgeExporter(f.options);
  let before = state();
  await exporter.flush(); f.tick(31_000); await exporter.flush(); await exporter.flush();
  assert.deepEqual(state(), before);
  control(f.coordinator, 'c2', planId, 1, 'start');
  before = state();
  assert.equal((await exporter.flush()).kind, 'changes');
  assert.deepEqual(state(), before);
  exporter.close();
});

test('a failed or mismatched acknowledgement keeps the checkpoint', async t => {
  const f = fixture(t); const { resourceId: planId } = create(f.coordinator, 'c1', 'item-1');
  const exporter = edgeExporter(f.options);
  f.setReply(() => new Response('busy', { status: 503 }));
  await assert.rejects(exporter.flush(), /unavailable/);
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  assert.equal((await exporter.flush()).kind, 'snapshot');
  assert.deepEqual(f.batches[0], f.batches[1]);
  control(f.coordinator, 'c2', planId, 1, 'start');
  f.setReply(body => ({ accepted: true, watermark: body.watermark + 1 }));
  await assert.rejects(exporter.flush(), /did not accept/);
  f.setReply(body => ({ accepted: true, watermark: body.watermark }));
  assert.equal((await exporter.flush()).kind, 'changes');
  assert.deepEqual(f.batches[2], f.batches[3]);
  assert.equal(f.batches[3].fromSequence, f.batches[1].watermark);
  exporter.close();
});

test('edge configuration needs a valid tokenEnv and reads the token from the environment', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bob-edge-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, config) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(config)); return path; };
  const base = { endpoint: 'https://edge.example/api/sdlc/ingest', checkpoint: '/tmp/edge.sqlite' };
  assert.throws(() => loadEdgeConfig(write('missing.json', base), {}), /tokenEnv/);
  assert.throws(() => loadEdgeConfig(write('invalid.json', { ...base, tokenEnv: 'bob-token' }), {}), /tokenEnv/);
  assert.throws(() => loadEdgeConfig(write('number.json', { ...base, tokenEnv: 42 }), {}), /tokenEnv/);
  assert.deepEqual(loadEdgeConfig(write('valid.json', { ...base, tokenEnv: 'BOB_SDLC_EDGE_TOKEN' }), { BOB_SDLC_EDGE_TOKEN: 'secret-token' }),
    { ...base, token: 'secret-token' });
});
