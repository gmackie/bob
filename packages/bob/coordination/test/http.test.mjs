import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { coordinationServer } from '../runtime/http.mjs';
import { createClient } from '../generated/client.mjs';
const target = { environmentId: 'mini', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'actor', targets: [target], issueProjects: [project] };
const token = 'test-only-credential-with-at-least-32-characters';
const operations = ['CreatePlan', 'ControlPlan', 'RequestExecution', 'GetItem', 'GetPlan', 'GetOperation', 'GetCapabilities', 'ListPlans', 'ReadEvents', 'RecordExecutionReceipt'];
const input = commandId => ({ contractVersion: '1', commandId, plan: { items: [{ itemId: commandId, issue: { ...project, issueId: 'BOB-46' }, issueSnapshotRef: 'scope', target, completionTarget: 'production' }], dependencies: [], concurrencyLimit: 1 } });
async function setup(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-http-')), database = join(dir, 'store.sqlite'); let server;
  const open = async () => {
    server = coordinationServer({ database, principals: [{ token, context, operations }], ...overrides });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, client: createClient({ baseUrl: url, headers: { Authorization: `Bearer ${token}` } }).functions };
  };
  const close = async () => { const stopped = once(server, 'close'); server.close(); server.closeIdleConnections(); await stopped; };
  t.after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
  return { ...await open(), restart: async () => { await close(); return open(); } };
}
test('HTTP admission survives restart, replays exactly and discovers bounded plans', async t => {
  const f = await setup(t); const request = input('create');
  const op = await f.client.createPlan(request, { idempotencyKey: request.commandId });
  const restarted = await f.restart();
  assert.deepEqual(await restarted.client.createPlan(request, { idempotencyKey: request.commandId }), op);
  await assert.rejects(restarted.client.createPlan({ ...request, plan: { ...request.plan, concurrencyLimit: 2 } }, { idempotencyKey: request.commandId }), error => error.code === 'IdempotencyConflict');
  const second = await restarted.client.createPlan(input('second'), { idempotencyKey: 'second' });
  const firstPage = await restarted.client.listPlans({ contractVersion: '1', limit: 1 });
  assert.equal(firstPage.plans.length, 1); assert(firstPage.nextPlanId);
  const secondPage = await restarted.client.listPlans({ contractVersion: '1', limit: 1, afterPlanId: firstPage.nextPlanId });
  assert.equal(secondPage.plans.length, 1); assert.equal(secondPage.nextPlanId, null);
  assert.deepEqual(new Set([...firstPage.plans, ...secondPage.plans].map(p => p.planId)), new Set([op.resourceId, second.resourceId]));
});
test('authentication, operation authority and body limits reject before mutation', async t => {
  const f = await setup(t, { maxBodyBytes: 1024 });
  const unauthorized = createClient({ baseUrl: f.url, headers: { Authorization: 'Bearer wrong', 'x-forge-actor': 'actor', 'x-forge-tenant': 'workspace' } }).functions;
  await assert.rejects(unauthorized.createPlan(input('unauthorized'), { idempotencyKey: 'unauthorized' }), error => error.status === 401);
  await assert.rejects(f.client.updatePlan({ contractVersion: '1' }), error => error.status === 403);
  const response = await fetch(f.url + '/api/v1/coordination/plans', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(2000) }) });
  assert.equal(response.status, 413);
  assert.deepEqual((await f.client.listPlans({ contractVersion: '1', limit: 50 })).plans, []);
});
test('network execution requests reserve once and remain queryable after restart', async t => {
  const f = await setup(t); const created = await f.client.createPlan(input('item'), { idempotencyKey: 'item' });
  await f.client.controlPlan({ contractVersion: '1', commandId: 'start', planId: created.resourceId, expectedVersion: 1, action: 'start' }, { idempotencyKey: 'start' });
  const request = { contractVersion: '1', requestId: 'request', attemptId: 'attempt', itemId: 'item', planId: created.resourceId, planVersion: 2, issueSnapshotRef: 'scope', target, work: { title: 'Task', instructions: 'Do it', acceptanceCriteria: ['Check it'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-46' }, executionProfileId: 'pistache' };
  const op = await f.client.requestExecution(request, { idempotencyKey: 'request' });
  const restarted = await f.restart();
  assert.deepEqual(await restarted.client.requestExecution(request, { idempotencyKey: 'request' }), op);
  assert.equal((await restarted.client.getItem({ contractVersion: '1', resourceId: 'item' })).item.state, 'reserved');
  assert.equal((await restarted.client.getOperation({ contractVersion: '1', resourceId: op.operationId })).state, 'accepted');
});
test('capabilities are authority-filtered and receipt identity cannot be supplied in a body', async t => {
  const f = await setup(t, { principals: [{ token, context, operations: ['GetCapabilities', 'RecordExecutionReceipt'] }] });
  const caps = await f.client.getCapabilities({ contractVersion: '1' });
  assert.deepEqual(caps.operations.sort(), ['GetCapabilities', 'RecordExecutionReceipt']); assert.equal(caps.durableExecutionAdmission, false);
  await assert.rejects(f.client.recordExecutionReceipt({ contractVersion: '1', eventId: 'event', environmentId: 'mini', executionId: 'execution', attemptId: 'attempt', sequence: 1, occurredAt: '2026-10-10T12:00:00Z', outcome: 'succeeded', thread: { environmentId: 'mini', projectId: 'bob', threadId: 'thread' }, sourceSnapshot: { repository: target.repository, commitSha: 'a'.repeat(40), treeDigest: 'b'.repeat(64), dirty: false }, evidenceRefs: [] }), error => error.code === 'Forbidden');
});
