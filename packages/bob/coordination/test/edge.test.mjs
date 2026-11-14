import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../runtime/coordinator.mjs';
import { edgeExporter } from '../runtime/edge.mjs';

const target = { environmentId: 'hetzner-bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'gmacko', actorId: 'graham', targets: [target], issueProjects: [project] };
const TOKEN = 't'.repeat(40), ENDPOINT = 'https://bob.test/api/sdlc/ingest';
const create = (c, commandId, itemId) => c.call('CreatePlan', { contractVersion: '1', commandId, plan: { items: [{ itemId, issue: { ...project, issueId: `issue-${itemId}` }, target, issueSnapshotRef: `snap-${itemId}`, completionTarget: 'production' }], dependencies: [], concurrencyLimit: 2 } }, { idempotencyKey: commandId });

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-edge-'));
  const coordinator = new Coordinator({ database: join(dir, 'coordination.sqlite'), context });
  const batches = [];
  let reply = body => ({ accepted: true, watermark: body.watermark });
  let clock = 1_000;
  const fetch = async (url, request) => {
    assert.equal(url, ENDPOINT); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(request.body); batches.push(body);
    return Response.json(reply(body));
  };
  t.after(() => { coordinator.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    coordinator, batches,
    options: { coordinator, endpoint: ENDPOINT, token: TOKEN, checkpoint: join(dir, 'edge.sqlite'), fetch, now: () => clock },
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
  for (const endpoint of ['http://bob.test/api/sdlc/ingest', 'https://u:p@bob.test/api/sdlc/ingest', 'https://bob.test/api/sdlc/ingest?x=1', 'https://bob.test/other']) {
    assert.throws(() => edgeExporter({ ...f.options, endpoint }));
  }
  assert.throws(() => edgeExporter({ ...f.options, token: 'short' }));
  assert.throws(() => edgeExporter({ ...f.options, checkpoint: ':memory:' }));
  assert.throws(() => edgeExporter({ ...f.options, checkpoint: f.coordinator.db.prepare('PRAGMA database_list').get().file }), /separate/);
});
