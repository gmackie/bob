import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { coordinationServer } from '../runtime/http.mjs';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { createClient } from '../generated/client.mjs';

const target = { environmentId: 'mini', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'supervisor', targets: [target], issueProjects: [project] };
const token = 'test-only-supervisor-credential-32-characters';
const readToken = 'test-only-reader-credential-with-32-characters';
const otherToken = 'test-only-other-workspace-credential-32-chars';
const receiptToken = 'test-only-execution-credential-with-32-chars';
const operations = ['GetCapabilities', 'ListPlans', 'GetPlan', 'GetItem', 'GetOperation', 'ReadEvents', 'CreatePlan', 'UpdatePlan', 'ControlPlan', 'RequestExecution', 'RetryItem', 'CancelItem', 'RequestDeployment', 'RecordExecutionReceipt'];
const principals = [
  { token, context, operations },
  { token: readToken, context, operations: ['GetCapabilities', 'ListPlans', 'GetPlan', 'GetItem'] },
  { token: otherToken, context: { ...context, workspaceId: 'another-workspace' }, operations },
  { token: receiptToken, context: { ...context, receiptEnvironmentId: target.environmentId }, operations: ['GetCapabilities', 'RecordExecutionReceipt'] },
];
const query = resourceId => ({ contractVersion: '1', resourceId });
const definition = () => ({ items: ['A', 'B'].map(itemId => ({ itemId, issue: { ...project, issueId: `BOB-${itemId}` }, issueSnapshotRef: 'scope-v1', target, completionTarget: 'production' })),
  dependencies: [{ upstreamItemId: 'A', downstreamItemId: 'B', requiredMilestone: 'execution-succeeded' }], concurrencyLimit: 1 });
const create = commandId => ({ contractVersion: '1', commandId, plan: definition() });
const execution = (planId, itemId = 'A') => ({ contractVersion: '1', requestId: `request-${itemId}`, attemptId: `attempt-${itemId}`, itemId, planId, planVersion: 2,
  issueSnapshotRef: 'scope-v1', target, work: { title: `Issue ${itemId}`, instructions: 'Implement the scoped issue and publish evidence', acceptanceCriteria: ['Current revision CI and target health must pass'] },
  workspace: { baseRevision: 'a'.repeat(40), branch: `BOB-68-${itemId}` }, executionProfileId: 'pistache' });
const admission = request => ({ contractVersion: '1', requestId: request.requestId, attemptId: request.attemptId, executionId: `execution-${request.itemId}`, target: request.target,
  thread: { environmentId: target.environmentId, projectId: target.projectId, threadId: `thread-${request.itemId}` } });
const receipt = request => ({ contractVersion: '1', eventId: `event-${request.itemId}`, environmentId: target.environmentId, executionId: admission(request).executionId, attemptId: request.attemptId,
  sequence: 1, occurredAt: '2026-11-12T19:00:00Z', outcome: 'succeeded', thread: admission(request).thread,
  sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['execution-log'] });

async function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-mcp-')), database = join(dir, 'state.sqlite');
  let server, url; const clients = [];
  async function open() {
    server = coordinationServer({ database, principals, ...options });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    await Promise.all(clients.splice(0).map(client => client.close()));
    const closed = once(server, 'close'); server.close(); server.closeIdleConnections(); await closed;
  }
  async function connect(credential = token) {
    const client = new Client({ name: 't3-factory-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${credential}` } } }));
    return client;
  }
  await open();
  t.after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
  return { database, get url() { return url; }, connect, restart: async () => { await close(); await open(); },
    rest: (credential = token) => createClient({ baseUrl: url, headers: { Authorization: `Bearer ${credential}` } }).functions };
}
async function call(client, name, input, errorCode) {
  const result = await client.callTool({ name, arguments: input });
  assert.equal(result.isError, Boolean(errorCode), JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  if (errorCode) assert.equal(result.structuredContent.code, errorCode);
  return result.structuredContent;
}

test('official MCP client discovers generated, implemented management tools and the supervisor prompt', async t => {
  const f = await setup(t), client = await f.connect();
  assert.equal(client.getServerVersion().name, 'bob-coordination');
  const tools = (await client.listTools()).tools;
  const names = tools.map(tool => tool.name);
  assert.equal(names.length, 11);
  for (const absent of ['bob_record_execution_receipt', 'bob_request_deployment', 'bob_cancel_item', 'bob_submit_execution']) assert(!names.includes(absent));
  const request = tools.find(tool => tool.name === 'bob_request_execution');
  assert(request.inputSchema.required.includes('requestId')); assert(request.inputSchema.required.includes('attemptId'));
  assert.equal(request.annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === 'bob_get_plan').annotations.readOnlyHint, true);
  const caps = await call(client, 'bob_get_capabilities', { contractVersion: '1' });
  assert(!caps.operations.includes('RecordExecutionReceipt')); assert(!caps.operations.includes('CancelItem'));
  assert.equal((await client.listPrompts()).prompts[0].name, 'factory-supervisor');
  const prompt = await client.getPrompt({ name: 'factory-supervisor' });
  assert.match(prompt.messages[0].content.text, /Unknown execution retains its slot/);
  assert.match(client.getInstructions(), /Never self-submit receipts/);
  assert.match(client.getInstructions(), /"environmentId":"mini"/);
  assert.match(client.getInstructions(), /"teamId":"GMA"/);
  assert(!client.getInstructions().includes(token)); assert(!client.getInstructions().includes('actorId'));
  await assert.rejects(client.getPrompt({ name: 'missing' }), /Unknown prompt/);
});

test('remote supervisor resumes durable plans and attempts across MCP/REST, lost dispatch response and restart', async t => {
  const verified = [];
  const f = await setup(t, { issueResolver: async issue => { verified.push(issue.issueId); } });
  let client = await f.connect();
  const created = await call(client, 'bob_create_plan', create('create'));
  assert.deepEqual(verified, ['BOB-A', 'BOB-B']);
  assert.equal((await f.rest().getPlan(query(created.resourceId))).state, 'draft');
  const start = { contractVersion: '1', commandId: 'start', planId: created.resourceId, expectedVersion: 1, action: 'start' };
  await call(client, 'bob_control_plan', start);
  const before = await call(client, 'bob_get_plan', query(created.resourceId));
  await call(client, 'bob_request_execution', execution(created.resourceId, 'B'), 'InvalidTransition');
  const request = execution(created.resourceId);
  const [accepted, replay] = await Promise.all([call(client, 'bob_request_execution', request), call(client, 'bob_request_execution', request)]);
  assert.deepEqual(replay, accepted);
  await call(client, 'bob_request_execution', { ...request, work: { ...request.work, title: 'Changed' } }, 'IdempotencyConflict');
  assert.deepEqual(await f.rest().requestExecution(request, { idempotencyKey: request.requestId }), accepted);
  let worker = new ExecutionCoordinator({ database: f.database, context }), submits = 0;
  const port = { requireCapabilities: async () => {}, find: async () => admission(request), submit: async () => { submits++; throw new Error('response lost after remote admission'); } };
  assert.equal((await worker.dispatchOne(port, { now: 1000, leaseMs: 1000 })).state, 'unknown');
  worker.close();
  await f.restart(); client = await f.connect();
  assert.deepEqual(await call(client, 'bob_create_plan', create('create')), created);
  assert.deepEqual(await call(client, 'bob_request_execution', request), accepted);
  assert.equal((await call(client, 'bob_get_item', query('A'))).item.state, 'execution-unknown');
  await call(client, 'bob_retry_item', { contractVersion: '1', commandId: 'unsafe-retry', itemId: 'A', expectedVersion: 4, previousAttemptId: request.attemptId, reason: 'timeout' }, 'ExecutionUnknown');
  worker = new ExecutionCoordinator({ database: f.database, context });
  try {
    assert.equal(worker.db.prepare('SELECT COUNT(*) AS n FROM coordination_attempt').get().n, 1);
    assert((await worker.dispatchOne(port, { now: 2001, leaseMs: 1000 })).dispatched);
    assert.equal(submits, 1);
    const event = receipt(request), receipts = f.rest(receiptToken);
    assert.deepEqual(await receipts.recordExecutionReceipt(event), await receipts.recordExecutionReceipt(event));
    const upstream = (await call(client, 'bob_get_item', query('A'))).item;
    assert.equal(upstream.state, 'validating'); assert.deepEqual(upstream.achievedMilestones, ['execution-succeeded']);
    assert.equal((await call(client, 'bob_get_item', query('B'))).item.state, 'ready');
    const second = execution(created.resourceId, 'B');
    await call(client, 'bob_request_execution', second);
    assert((await worker.dispatchOne({ ...port, submit: async r => { submits++; return admission(r); } })).dispatched);
    await receipts.recordExecutionReceipt(receipt(second));
    assert.equal(submits, 2);
    assert.equal((await call(client, 'bob_get_item', query('B'))).item.state, 'validating');
    assert.equal((await call(client, 'bob_get_operation', query(accepted.operationId))).state, 'succeeded');
    const events = await call(client, 'bob_read_events', { contractVersion: '1', cursor: before.eventCursor, limit: 100 });
    assert(events.events.some(event => event.resourceId === 'B'));
    assert.equal((await call(client, 'bob_read_events', { contractVersion: '1', cursor: events.nextCursor, limit: 100 })).events.length, 0);
  } finally { worker.close(); }
});

test('supervisor authority, scope and legal transitions are enforced by Bob for every tool call', async t => {
  const f = await setup(t), writer = await f.connect(), reader = await f.connect(readToken), other = await f.connect(otherToken);
  assert.deepEqual((await reader.listTools()).tools.map(tool => tool.name).sort(), ['bob_get_capabilities', 'bob_get_item', 'bob_get_plan', 'bob_list_plans']);
  await call(reader, 'bob_create_plan', create('reader-create'), 'CapabilityUnavailable');
  const created = await call(writer, 'bob_create_plan', create('owner-create'));
  assert.equal((await call(reader, 'bob_get_plan', query(created.resourceId))).planId, created.resourceId);
  await call(other, 'bob_get_plan', query(created.resourceId), 'NotFound');
  assert.equal((await call(other, 'bob_list_plans', { contractVersion: '1', limit: 10 })).plans.length, 0);
  for (const [key, change] of [['workspace', item => { item.issue.workspaceId = 'foreign'; }], ['target', item => { item.target.environmentId = 'foreign'; }]]) {
    const body = create(`foreign-${key}`); change(body.plan.items[0]);
    await call(writer, 'bob_create_plan', body, 'Forbidden');
  }
  await call(writer, 'bob_get_capabilities', {}, 'InvalidRequest');
  await call(writer, 'bob_control_plan', { contractVersion: '1', commandId: 'stale-start', planId: created.resourceId, expectedVersion: 99, action: 'start' }, 'VersionConflict');
  await call(writer, 'bob_record_execution_receipt', receipt(execution(created.resourceId)), 'CapabilityUnavailable');
  await call(writer, 'bob_request_deployment', {}, 'CapabilityUnavailable');
  await call(writer, 'bob_read_events', { contractVersion: '1', cursor: 'lost-cursor', limit: 10 }, 'CursorExpired');
  assert.equal((await call(writer, 'bob_list_plans', { contractVersion: '1', limit: 10 })).plans.length, 1);
});

test('MCP transport authenticates and rejects origins, oversized bodies, malformed messages and connection-level mutation keys', async t => {
  const f = await setup(t, { maxBodyBytes: 1024, allowedOrigins: ['https://t3.example'] });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const request = body => ({ method: 'POST', headers, body: JSON.stringify(body) });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await fetch(`${f.url}/mcp`, { ...request(body), headers: { ...headers, Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${f.url}/mcp`, { headers })).status, 405);
  assert.equal((await fetch(`${f.url}/mcp`, { ...request(body), headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(`${f.url}/mcp`, { ...request(body), headers: { ...headers, Origin: 'https://t3.example' } })).status, 200);
  assert.equal((await fetch(`${f.url}/mcp`, request({ ...body, padding: 'x'.repeat(2000) }))).status, 413);
  assert.equal((await fetch(`${f.url}/mcp`, { ...request(body), headers: { ...headers, 'Idempotency-Key': 'connection-key' } })).status, 400);
  assert.equal((await fetch(`${f.url}/mcp`, { ...request(body), headers: { ...headers, Accept: 'application/json' } })).status, 406);
  const malformed = await fetch(`${f.url}/mcp`, { method: 'POST', headers, body: '{broken' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, -32700);
  assert.equal((await fetch(`${f.url}/mcp`, request({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  const unsupported = await fetch(`${f.url}/mcp`, request({ ...body, method: 'not/a/method' }));
  assert.equal((await unsupported.json()).error.code, -32601);
});

test('unexpected integration errors stay structured and do not expose credentials or internal diagnostics', async t => {
  const f = await setup(t, { issueResolver: async () => { throw new Error(`database password ${token} at /private/internal/path`); } });
  const client = await f.connect();
  const error = await call(client, 'bob_create_plan', create('integration-failure'), 'InternalError');
  assert.equal(error.retryable, true);
  assert(!JSON.stringify(error).includes(token)); assert(!JSON.stringify(error).includes('/private/'));
  assert.equal((await call(client, 'bob_list_plans', { contractVersion: '1', limit: 10 })).plans.length, 0);
});
