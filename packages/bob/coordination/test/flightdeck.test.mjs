import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flightdeckExporter } from '../runtime/flightdeck.mjs';
import { runWorker } from '../runtime/worker.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-flightdeck-'));
  const db = new DatabaseSync(join(dir, 'domain.sqlite'));
  db.exec('CREATE TABLE coordination_issue_effect(tenant TEXT,owner TEXT,id TEXT,fact TEXT,payload TEXT,created_at TEXT)');
  const insert = (id, tenant = 'workspace') => db.prepare('INSERT INTO coordination_issue_effect VALUES (?,?,?,?,?,?)').run(tenant, 'owner', id, 'admitted', JSON.stringify({ planId: 'plan-1', attemptId: id, environmentId: 't3', work: 'PRIVATE PROMPT', token: 'SECRET', evidenceRefs: ['https://private.test'] }), new Date().toISOString());
  insert('attempt-1'); insert('foreign', 'another-workspace');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { coordinator: { db, tenant: 'workspace', owner: 'owner' }, endpoint: 'https://flightdeck.test/v1/server/events', token: 'a'.repeat(48), checkpoint: join(dir, 'analytics.sqlite'), insert };
}

test('exporter replays durable facts with stable ids after failed acceptance and restart, without private data', async t => {
  const options = fixture(t), batches = [];
  let fail = true;
  const send = async (url, request) => {
    assert.equal(request.redirect, 'error'); assert.equal(url, options.endpoint);
    const body = JSON.parse(request.body); batches.push(body);
    return Response.json(fail ? { accepted: 0, rejected: 1 } : { accepted: body.events.length, rejected: 0 });
  };
  let exporter = flightdeckExporter({ ...options, fetch: send });
  await assert.rejects(exporter.flush(), /full batch/); exporter.close();
  fail = false; exporter = flightdeckExporter({ ...options, fetch: send });
  assert.deepEqual(await exporter.flush(), { exported: 1 });
  assert.deepEqual(batches[0], batches[1]);
  assert.equal(batches[1].events[0].props.attemptId, 'attempt-1');
  const wire = JSON.stringify(batches);
  for (const secret of ['PRIVATE', 'SECRET', 'evidenceRefs', 'foreign', 'private.test']) assert(!wire.includes(secret));
  assert.deepEqual(await exporter.flush(), { exported: 0 });
  options.insert('attempt-2');
  assert.deepEqual(await exporter.flush(), { exported: 1 });
  exporter.close();
  assert.equal(options.coordinator.db.prepare('SELECT COUNT(*) AS n FROM coordination_issue_effect').get().n, 3);
});

test('exporter rejects unsafe configuration and the source database as its checkpoint', t => {
  const options = fixture(t);
  for (const endpoint of ['http://host/v1/server/events', 'https://user:secret@host/v1/server/events', 'https://host/v1/server/events?token=secret']) assert.throws(() => flightdeckExporter({ ...options, endpoint }));
  assert.throws(() => flightdeckExporter({ ...options, checkpoint: options.coordinator.db.prepare('PRAGMA database_list').get().file }), /separate/);
});

test('analytics failure does not stop worker dispatch or leak its exception', async () => {
  const controller = new AbortController(), lines = []; let calls = 0;
  await runWorker({ coordinator: { dispatchOne: async () => { calls++; return { dispatched: false }; } }, port: {}, intervalMs: 10, signal: controller.signal,
    flightdeck: { flush: async () => { controller.abort(); throw new Error('SECRET'); } }, log: line => lines.push(line) });
  assert.equal(calls, 1);
  assert(lines.some(line => line.step === 'flightdeck' && line.outcome === 'unavailable'));
  assert(!JSON.stringify(lines).includes('SECRET'));
});
