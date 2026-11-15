import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { loadEdgeConfig } from '../runtime/edge.mjs';
import { tailRelay, tailLines, pendingInputFrom, sanitizeText, TAIL_LIMITS } from '../runtime/tail.mjs';
import { inputCommandId } from '../runtime/input.mjs';
import { fakeT3 } from './fixtures/fake-t3.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const context = { workspaceId: 'workspace', actorId: 'edge-principal', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob' };
const call = (c, name, body, extra = {}) => c.call(name, { contractVersion: '1', ...body }, { idempotencyKey: body.commandId ?? body.requestId, ...extra });
const getItem = (c, id = 'item-1') => c.call('GetItem', { contractVersion: '1', resourceId: id }).item;
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!(await fn())) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };
const THREAD = 'thread-attempt-1', TOKEN = 'e'.repeat(40);
const questions = [{ id: 'q1', header: 'Target', question: 'Which stage?', options: [{ label: 'Staging', value: 'staging', description: 'beta' }, { label: 'Production' }], multiSelect: false, allowCustomAnswer: true }];

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-tail-')), database = join(dir, 'store.sqlite');
  const c = new ExecutionCoordinator({ database, context });
  const plan = call(c, 'CreatePlan', { commandId: 'create', plan: { items: [{ itemId: 'item-1', issue: { ...project, issueId: 'item-1' }, issueSnapshotRef: 'snapshot', target, completionTarget: 'execution' }], dependencies: [], concurrencyLimit: 1 } });
  call(c, 'ControlPlan', { commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  const body = { requestId: 'request-1', attemptId: 'attempt-1', itemId: 'item-1', planId: plan.resourceId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task', instructions: 'Do work', acceptanceCriteria: ['Check'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-80' }, executionProfileId: 'pistache' };
  call(c, 'RequestExecution', body);
  const admission = { contractVersion: '1', requestId: body.requestId, executionId: 'execution-1', attemptId: body.attemptId, target, thread: { environmentId: 'bob', projectId: 'bob', threadId: THREAD } };
  await c.dispatchOne({ requireCapabilities: async () => {}, submit: async () => admission, find: async () => null });
  const t3 = await fakeT3();
  t3.addThread(THREAD);
  const posts = [], logs = [];
  const fetch = async (url, request) => { posts.push({ url, authorization: request.headers.Authorization, body: JSON.parse(request.body) }); return new Response('{"accepted":1}'); };
  const relays = [];
  const relay = (extra = {}) => {
    const r = tailRelay({ coordinator: c, bindings: [{ target, baseUrl: t3.url, authToken: t3.token }], edge: { endpoint: 'https://bob.test/api/sdlc/ingest', token: TOKEN }, fetch, log: line => logs.push(line), postIntervalMs: 100, retryMs: 50, ...extra });
    relays.push(r); return r;
  };
  t.after(async () => { for (const r of relays) r.close(); await t3.close(); c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { c, t3, relay, posts, logs, body, admission, dir };
}
const tickUntil = (relay, fn) => until(async () => { await relay.tick(); return fn(); });
const resolve = (c, commandId, answer = { q1: 'staging' }) => call(c, 'ResolveInput', { commandId, attemptId: 'attempt-1', promptId: 'rr-1', answer: JSON.stringify(answer) }, { actor: 'bob-user-1' });

test('a t3 user_input question puts the item in waiting-input; the answer is delivered once and the item returns to running', async t => {
  const { c, t3, relay, logs } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', [...questions, { id: 'q2', question: 'Notes?', options: [], multiSelect: false }]);
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  const waiting = getItem(c);
  assert.deepEqual(waiting.pendingInput, { attemptId: 'attempt-1', promptId: 'rr-1', kind: 'user_input', createdAt: '2026-11-15T10:00:00.000Z',
    questions: [{ id: 'q1', header: 'Target', question: 'Which stage?', options: [{ label: 'Staging', value: 'staging', description: 'beta' }, { label: 'Production' }], multiSelect: false },
      { id: 'q2', question: 'Notes?', options: [], multiSelect: false }] });
  const op = resolve(c, 'answer-1', { q1: 'staging', q2: 'secret answer text' });
  assert.equal(getItem(c).state, 'running');
  await tickUntil(r, () => t3.state.responds.length === 1 && c.pendingInputDeliveries().length === 0);
  assert.deepEqual(t3.state.responds[0], { type: 'runtime-request.respond', commandId: inputCommandId('attempt-1', 'rr-1', 'answer-1'), threadId: THREAD, requestId: 'rr-1', answers: { q1: 'staging', q2: 'secret answer text' } });
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state, 'succeeded');
  // t3 resolving the request (shell pending cleared) leaves the item running; nothing re-records it.
  for (let i = 0; i < 5; i++) await r.tick();
  assert.equal(getItem(c).state, 'running'); assert.equal(t3.state.responds.length, 1);
  const text = JSON.stringify(logs);
  assert(!text.includes('secret answer text') && !text.includes(t3.token) && !text.includes(TOKEN) && !text.includes('Which stage?'));
});

test('a queued answer is delivered exactly once across relay restarts', async t => {
  const { c, t3, relay } = await setup(t);
  const first = relay();
  await tickUntil(first, () => first.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  await tickUntil(first, () => getItem(c).state === 'waiting-input');
  t3.state.respondDie = true; // a Die (defect) is retryable
  resolve(c, 'answer-1');
  await tickUntil(first, () => t3.state.responds.length === 1);
  assert.equal(c.pendingInputDeliveries({ now: Date.now() + 120_000 }).length, 1); // deferred, still queued
  first.close(); // relay restarts with the answer still queued
  t3.state.respondDie = false;
  const second = relay();
  c.db.prepare('UPDATE coordination_input_delivery SET next_attempt_at=0').run();
  await tickUntil(second, () => c.pendingInputDeliveries({ now: Date.now() + 120_000 }).length === 0);
  assert.equal(t3.state.responds.length, 2); // one failed try, one delivery
  second.close();
  const third = relay();
  for (let i = 0; i < 10; i++) await third.tick();
  assert.equal(t3.state.responds.length, 2);
  assert.equal(c.db.prepare('SELECT status FROM coordination_input_delivery').get().status, 'delivered');
});

test('a delivery whose settlement was lost is recognized from t3 and not sent again', async t => {
  const { c, t3, relay } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  r.close();
  resolve(c, 'answer-1');
  t3.resolve(THREAD, 'rr-1', { q1: 'staging' }); // t3 already has exactly our answer
  const again = relay();
  await tickUntil(again, () => c.pendingInputDeliveries().length === 0);
  assert.equal(t3.state.responds.length, 0);
  assert.equal(c.db.prepare('SELECT status FROM coordination_input_delivery').get().status, 'delivered');
});

test('a delivery whose ack was lost is ours when t3 recorded the option label for our value', async t => {
  const { c, t3, relay } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  r.close();
  const op = resolve(c, 'answer-1', { q1: 'staging' });
  t3.resolve(THREAD, 'rr-1', { q1: 'Staging', extra: 'ignored' }); // t3 stored the label of our value
  const again = relay();
  await tickUntil(again, () => c.pendingInputDeliveries().length === 0);
  assert.equal(t3.state.responds.length, 0);
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state, 'succeeded');
});

test('a non-retryable t3 failure abandons the delivery, fails the Operation, and the prompt can be answered again', async t => {
  const { c, t3, relay } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  t3.state.respondError = 'refused';
  const op = resolve(c, 'answer-1');
  await tickUntil(r, () => c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state === 'failed');
  assert.equal(t3.state.responds.length, 1);
  const failed = c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId });
  assert.equal(failed.error.code, 'InputNotDelivered'); assert.match(failed.error.message, /OrchestrationV2DispatchCommandError/);
  assert.equal(c.db.prepare('SELECT last_error FROM coordination_input_delivery').get().last_error, 'OrchestrationV2DispatchCommandError');
  // t3 still shows the prompt pending: the item goes back to waiting-input and a new answer is queued and delivered.
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  t3.state.respondError = null;
  const second = resolve(c, 'answer-2', { q1: 'Production' });
  await tickUntil(r, () => c.call('GetOperation', { contractVersion: '1', resourceId: second.operationId }).state === 'succeeded');
  assert.equal(t3.state.responds.length, 2);
  assert.notEqual(t3.state.responds[1].commandId, t3.state.responds[0].commandId);
  assert.deepEqual(t3.state.responds[1].answers, { q1: 'Production' });
});

test('a failed recordPendingInput is retried after a cooldown', async t => {
  const { c, t3, relay } = await setup(t);
  let clock = 1_000_000;
  const original = c.recordPendingInput.bind(c);
  let fail = true;
  c.recordPendingInput = args => { if (fail) throw Object.assign(new Error('busy'), { code: 'Busy' }); return original(args); };
  const r = relay({ now: () => clock });
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  for (let i = 0; i < 5; i++) { await new Promise(r2 => setTimeout(r2, 10)); await r.tick(); }
  assert.equal(getItem(c).state, 'running');
  fail = false;
  await r.tick(); await r.tick();
  assert.equal(getItem(c).state, 'running'); // still cooling down
  clock += 10_001;
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
});

test('a question answered elsewhere clears waiting-input, and a Bob answer that lost the race is abandoned', async t => {
  const { c, t3, relay } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-1', questions);
  await tickUntil(r, () => getItem(c).state === 'waiting-input');
  t3.resolve(THREAD, 'rr-1', { q1: 'answered in the T3 UI' });
  await tickUntil(r, () => getItem(c).state === 'running');
  assert.equal('pendingInput' in getItem(c), false);
  // A second question: Bob answers, but the T3 UI answers first with something else.
  t3.ask(THREAD, 'rr-2', questions);
  await tickUntil(r, () => getItem(c).pendingInput?.promptId === 'rr-2');
  r.close();
  const op = call(c, 'ResolveInput', { commandId: 'late', attemptId: 'attempt-1', promptId: 'rr-2', answer: '{"q1":"staging"}' });
  t3.resolve(THREAD, 'rr-2', { q1: 'Production' });
  const again = relay();
  await tickUntil(again, () => c.pendingInputDeliveries().length === 0);
  assert.equal(t3.state.responds.length, 0);
  assert.equal(c.call('GetOperation', { contractVersion: '1', resourceId: op.operationId }).state, 'failed');
});

test('userOnly and not_resumable requests are never recorded', async t => {
  const { c, t3, relay, posts } = await setup(t);
  const r = relay();
  await tickUntil(r, () => r.following.includes('attempt-1'));
  t3.ask(THREAD, 'rr-secret', questions, { userOnly: true });
  t3.ask(THREAD, 'rr-gone', questions, { capability: { type: 'not_resumable', reason: 'provider restarted' } });
  t3.item(THREAD, { type: 'assistant_message', id: 'm-after', ordinal: 60, text: 'after' });
  await tickUntil(r, () => posts.some(p => p.body.frames[0].lines.includes('after')));
  for (let i = 0; i < 5; i++) { await new Promise(r2 => setTimeout(r2, 10)); await r.tick(); }
  assert.equal(getItem(c).state, 'running');
});

test('tail frames are clamped, throttled per POST interval and sent to the edge origin with the ingest token', async t => {
  const { c, t3, relay, posts, body } = await setup(t);
  let clock = 1_000_000;
  const r = relay({ now: () => clock, postIntervalMs: 2000 });
  await tickUntil(r, () => r.following.includes('attempt-1'));
  const long = Array.from({ length: 60 }, (_, i) => `line ${i} ` + 'x'.repeat(i === 59 ? 500 : 5)).join('\n');
  t3.item(THREAD, { type: 'reasoning', id: 'r1', ordinal: 1, text: 'thinking' });
  t3.item(THREAD, { type: 'command_execution', id: 'c1', ordinal: 2, input: 'npm test', exitCode: 1, outputOmitted: true });
  t3.item(THREAD, { type: 'assistant_message', id: 'a1', ordinal: 3, text: long });
  t3.item(THREAD, { type: 'user_message', id: 'u1', ordinal: 4, text: 'not in the tail' });
  // Each step lets one POST interval pass, until the last frame shows every item.
  await tickUntil(r, () => { const done = posts.at(-1)?.body.frames[0].lines.at(-1)?.startsWith('line 59'); if (!done) clock += 2000; return done; });
  const post = posts.at(-1);
  assert.equal(post.url, 'https://bob.test/api/sdlc/tail'); assert.equal(post.authorization, `Bearer ${TOKEN}`);
  const [frame] = post.body.frames;
  assert.deepEqual(Object.keys(frame).sort(), ['at', 'attemptId', 'itemId', 'lines', 'threadId', 'threadStatus']);
  assert.equal(frame.itemId, 'item-1'); assert.equal(frame.threadId, THREAD); assert.equal(frame.threadStatus, 'running');
  assert.equal(frame.lines.length, 40); assert(frame.lines.every(line => line.length <= TAIL_LIMITS.maxLineChars));
  assert(!frame.lines.includes('not in the tail'));
  // Throttle: changes within the interval wait for the next POST.
  const count = posts.length;
  t3.item(THREAD, { type: 'assistant_message', id: 'a2', ordinal: 5, text: 'newer' });
  await new Promise(r2 => setTimeout(r2, 50)); await r.tick(); await r.tick();
  assert.equal(posts.length, count);
  clock += 2000;
  await tickUntil(r, () => posts.length === count + 1);
  assert.equal(posts.at(-1).body.frames[0].lines.at(-1), 'newer');
  // The attempt ends: the thread is unfollowed (Interrupt sent) and nothing more is posted.
  c.call('RecordExecutionReceipt', { contractVersion: '1', eventId: 'event-1', environmentId: 'bob', executionId: 'execution-1', attemptId: 'attempt-1', sequence: 1, occurredAt: '2026-11-15T12:00:00Z', outcome: 'succeeded', thread: { environmentId: 'bob', projectId: 'bob', threadId: THREAD }, sourceSnapshot: { repository: target.repository, commitSha: 'b'.repeat(40), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['log'] });
  assert.equal(body.attemptId, 'attempt-1');
  await r.tick();
  assert.deepEqual(r.following, []);
  await until(() => t3.state.received.some(m => m._tag === 'Interrupt'));
});

test('agent-controlled text is stripped of escape sequences and control characters', () => {
  assert.deepEqual(tailLines([{ type: 'assistant_message', ordinal: 1, text: 'ok\u001b[31m red\u001b[0m\u001b]8;;https://evil.test\u0007link\u001b]8;;\u0007\r\n\ttab\u0000\u009b2J' }]), ['ok redlink', '  tab']);
  assert.deepEqual(tailLines([{ type: 'command_execution', ordinal: 1, input: 'rm\u001b[2K -rf\u001bP1$r\u001b\\ x', exitCode: 0 }]), ['$ rm -rf x (exit 0)']);
  assert.equal(sanitizeText('a\u001b]0;pwn\u001b\\b\u0085c\u007f'), 'abc');
  const input = pendingInputFrom('a1', { id: 'rr' }, { questions: [{ id: 'q1', header: 'H\u001b[1mX', question: 'Line 1\r\nLine\u001b]0;t\u0007 2',
    options: [{ label: 'Stage\u001b[31ming', description: 'd\u0007\nx' }, { label: 'Prod', value: 'prod\u001b' }, { label: '\u001b[0m' }] }] }, '2026-11-15T10:00:00.000Z');
  const [q] = input.questions;
  assert.equal(q.header, 'HX'); assert.equal(q.question, 'Line 1\nLine 2');
  // A label changed by sanitizing keeps the original as the value t3 receives; values are not display text.
  assert.deepEqual(q.options, [{ label: 'Stageing', value: 'Stage\u001b[31ming', description: 'd x' }, { label: 'Prod', value: 'prod\u001b' }, { label: '(option)', value: '\u001b[0m' }]);
});

test('tailLines renders commands, messages and reasoning in ordinal order', () => {
  assert.deepEqual(tailLines([
    { type: 'assistant_message', ordinal: 3, text: 'done\n' },
    { type: 'command_execution', ordinal: 2, input: 'ls', exitCode: 0 },
    { type: 'reasoning', ordinal: 1, text: 'plan' },
    { type: 'file_change', ordinal: 4, fileName: 'x' },
  ]), ['plan', '$ ls (exit 0)', 'done']);
  assert.equal(tailLines([{ type: 'assistant_message', ordinal: 1, text: 'y'.repeat(300) }])[0].length, 200);
});

test('edge.json tail block: optional, strict, and passed apart from exporter options', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bob-tail-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = config => { const path = join(dir, 'edge.json'); writeFileSync(path, JSON.stringify({ endpoint: 'https://bob.test/api/sdlc/ingest', checkpoint: join(dir, 'edge.sqlite'), tokenEnv: 'EDGE_TOKEN', ...config })); return path; };
  const env = { EDGE_TOKEN: TOKEN };
  assert.equal(loadEdgeConfig(write({}), env).tail, undefined);
  assert.deepEqual(loadEdgeConfig(write({ tail: {} }), env).tail, { postIntervalMs: 2000 });
  assert.deepEqual(loadEdgeConfig(write({ tail: { postIntervalMs: 5000 } }), env).tail, { postIntervalMs: 5000 });
  assert.throws(() => loadEdgeConfig(write({ tail: { postIntervalMs: 500 } }), env));
  assert.throws(() => loadEdgeConfig(write({ tail: { lines: 10 } }), env));
  assert.throws(() => loadEdgeConfig(write({ tail: true }), env));
});

test('runWorker runs the tail relay beside dispatch and stops it on abort', async t => {
  const { runWorker } = await import('../runtime/worker.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'bob-tail-worker-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = new ExecutionCoordinator({ database: join(dir, 'store.sqlite'), context }); t.after(() => c.close());
  const controller = new AbortController(), calls = [];
  const tail = { run: async ({ signal }) => { calls.push('run'); await new Promise(r => signal.addEventListener('abort', r)); calls.push('stopped'); }, close: () => calls.push('close') };
  const done = runWorker({ coordinator: c, port: {}, tail, intervalMs: 10, signal: controller.signal, log: () => {} });
  await until(() => calls.includes('run'));
  controller.abort(); await done;
  assert.deepEqual(calls, ['run', 'close', 'stopped']);
});
