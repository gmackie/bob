import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { connect, RESUBSCRIBING, T3RpcError } from '../runtime/t3-client.mjs';
import { fakeT3 } from './fixtures/fake-t3.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/t3-frames/${name}.json`, import.meta.url), 'utf8'));
const withId = (value, id) => JSON.parse(JSON.stringify(value).replaceAll('"$id"', JSON.stringify(id)));
const withoutId = ({ id: _id, ...rest }) => rest;
const fast = { pingMs: 50, idleTimeoutMs: 2000, backoff: { initialMs: 10, maxMs: 50 }, requestTimeoutMs: 2000 };
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };
const take = async (iterable, n) => { const out = []; for await (const item of iterable) { out.push(item); if (out.length === n) break; } return out; };

/** A scripted server: replies to each Request with fixture frames, one Chunk per Ack (§2.4). */
async function scripted(t, respond) {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  const received = [], connections = [];
  wss.on('connection', (ws, request) => {
    connections.push({ ws, url: request.url, authorization: request.headers.authorization });
    const queues = new Map();
    const pump = id => { const q = queues.get(id); if (!q || q.waiting || !q.frames.length) return; const frame = q.frames.shift(); q.waiting = !Array.isArray(frame) && frame._tag === 'Chunk'; ws.send(JSON.stringify(frame)); pump(id); };
    ws.on('message', data => {
      const message = JSON.parse(String(data)); received.push(message);
      if (message._tag === 'Ack') { const q = queues.get(message.requestId); if (q) { q.waiting = false; pump(message.requestId); } }
      if (message._tag === 'Request') { const frames = respond(message, ws); if (frames) { queues.set(message.id, { frames: withId(frames, message.id), waiting: false }); pump(message.id); } }
    });
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(() => { for (const c of connections) c.ws.terminate(); wss.close(); http.close(); });
  return { url: `http://127.0.0.1:${http.address().port}`, received, connections };
}

test('subscribeThread sends the spec request, Acks every Chunk and yields items until Exit Success', async t => {
  const server = await scripted(t, message => message.tag === 'orchestration.subscribeThread' ? fixture('thread-stream').frames : null);
  const client = connect({ baseUrl: server.url, authToken: 'token-1', ...fast }); t.after(() => client.close());
  const items = [];
  for await (const item of client.subscribeThread('thr_pilot')) items.push(item);
  assert.deepEqual(items.map(i => i.kind), ['snapshot', 'synchronized', 'event', 'event']);
  assert.equal(items[0].projection.turnItems.find(i => i.type === 'command_execution').outputOmitted, true);
  const request = server.received.find(m => m._tag === 'Request');
  assert.deepEqual(withoutId(request), fixture('request-subscribe-thread').expected);
  const chunks = fixture('thread-stream').frames.filter(f => f._tag === 'Chunk').length;
  assert.equal(server.received.filter(m => m._tag === 'Ack' && m.requestId === request.id).length, chunks);
  // §1.1/§1.2: /ws?orchestrationProtocol=2 with the bearer on the upgrade.
  assert.equal(server.connections[0].url, '/ws?orchestrationProtocol=2');
  assert.equal(server.connections[0].authorization, 'Bearer token-1');
});

test('subscribeShell sends only the deployed-server fields and yields enrichment snapshots unchanged', async t => {
  const server = await scripted(t, message => message.tag === 'orchestration.subscribeShell' ? fixture('shell-stream').frames : null);
  const client = connect({ baseUrl: server.url, authToken: 'token-1', ...fast }); t.after(() => client.close());
  const stream = client.subscribeShell();
  const items = await take(stream, 5);
  assert.deepEqual(withoutId(server.received.find(m => m._tag === 'Request')), fixture('request-subscribe-shell').expected);
  assert.equal(items[1].resolvedRepositoryIdentityRoots[0], '/repo');
  assert.deepEqual(items.map(i => i.kind), ['snapshot', 'snapshot', 'synchronized', 'thread.updated', 'thread.removed']);
  assert.equal(stream.cursor, 98233); // §4: highest thread.* sequence; the enrichment snapshot does not move it
});

test('respondUserInput resolves on Exit Success, rejects a declared Fail with its tag and a Die as retryable', async t => {
  let reply = 'exit-success';
  const server = await scripted(t, () => fixture(reply).frames);
  const client = connect({ baseUrl: server.url, authToken: 'token-1', ...fast }); t.after(() => client.close());
  const args = { threadId: 'thr_pilot', requestId: 'rr_1', answers: { q1: 'staging' }, commandId: 'bob-input-1' };
  assert.deepEqual(await client.respondUserInput(args), { sequence: 4190 });
  assert.deepEqual(withoutId(server.received.find(m => m._tag === 'Request')), fixture('request-respond').expected);
  reply = 'exit-fail';
  await assert.rejects(client.respondUserInput(args), error => error instanceof T3RpcError && error.code === 'OrchestrationV2DispatchCommandError' && !error.retryable);
  reply = 'exit-die';
  await assert.rejects(client.respondUserInput(args), error => error.code === 'Defect' && error.retryable);
  reply = 'batched-frame'; // §2.1: an array of messages in one frame
  assert.deepEqual(await client.respondUserInput(args), { sequence: 4190 });
  const ids = server.received.filter(m => m._tag === 'Request').map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a Defect drops the socket; the stream reconnects and resumes from its last sequence', async t => {
  let first = true;
  const server = await scripted(t, message => {
    if (message.tag !== 'orchestration.subscribeThread') return null;
    if (first) { first = false; return [...fixture('thread-stream').frames.slice(0, 3), ...fixture('defect').frames]; }
    return [{ _tag: 'Chunk', requestId: '$id', values: [{ kind: 'event', sequence: 4172, event: { type: 'x' } }, { kind: 'event', sequence: 4173, event: { type: 'turn-item.updated', payload: { id: 'ti_6' } } }] }, { _tag: 'Chunk', requestId: '$id', values: [{ kind: 'synchronized' }] }];
  });
  const client = connect({ baseUrl: server.url, authToken: 'token-1', ...fast }); t.after(() => client.close());
  const items = await take(client.subscribeThread('thr_pilot'), 7);
  assert.deepEqual(items.map(i => i.kind === 'event' ? i.sequence : i.kind), ['snapshot', 'synchronized', 4171, 4172, RESUBSCRIBING, 4173, 'synchronized']);
  const requests = server.received.filter(m => m._tag === 'Request');
  assert.equal(requests[1].payload.afterSequence, 4172);
  assert(server.connections.length >= 2);
});

test('against the fake t3 server: resume after a dropped connection drops the replay overlap, and pings get pongs', async t => {
  const t3 = await fakeT3(); t.after(() => t3.close());
  t3.addThread('thr_a');
  const client = connect({ baseUrl: t3.url, authToken: t3.token, ...fast }); t.after(() => client.close());
  const stream = client.subscribeThread('thr_a');
  const iterator = stream[Symbol.asyncIterator]();
  const seen = [];
  const pull = async n => { for (let i = 0; i < n; i++) seen.push((await iterator.next()).value); };
  await pull(2); // snapshot, synchronized
  t3.item('thr_a', { type: 'assistant_message', id: 'm1', ordinal: 1, text: 'one' });
  t3.item('thr_a', { type: 'assistant_message', id: 'm2', ordinal: 2, text: 'two' });
  await pull(2);
  t3.dropConnections();
  await pull(1); // RESUBSCRIBING
  t3.item('thr_a', { type: 'assistant_message', id: 'm3', ordinal: 3, text: 'three' });
  await pull(2); // replay → m3 (the overlapping m2 is dropped), synchronized
  const kinds = seen.map(i => i.kind === 'event' ? i.event.payload.id : i.kind);
  assert.deepEqual(kinds, ['snapshot', 'synchronized', 'm1', 'm2', RESUBSCRIBING, 'm3', 'synchronized']);
  const subscribes = t3.state.received.filter(m => m.tag === 'orchestration.subscribeThread');
  assert.equal(subscribes.at(-1).payload.afterSequence, 102);
  await until(() => t3.state.received.some(m => m._tag === 'Ping'));
  assert(t3.state.upgrades.every(u => u.protocol === '2' && u.authorization === `Bearer ${t3.token}`));
  // The fake sends no second Chunk before an Ack, so the stream would stall without them. The Ack for the
  // last Chunk before the drop may die with that socket: 3 + 2 at least.
  await until(() => t3.acks() >= 5);
});

test('an idle socket is dropped and redialled; a rejected upgrade backs off without leaking the token', async t => {
  const server = await scripted(t, () => null); // never answers, not even Pong
  const events = [];
  const client = connect({ baseUrl: server.url, authToken: 'secret-token', ...fast, pingMs: 20, idleTimeoutMs: 60, onEvent: e => events.push(e) }); t.after(() => client.close());
  await until(() => server.connections.length >= 2);
  assert(events.some(e => e.type === 'idle-timeout'));
  const t3 = await fakeT3(); t.after(() => t3.close());
  const rejected = connect({ baseUrl: t3.url, authToken: 'wrong', ...fast, onEvent: e => events.push(e) }); t.after(() => rejected.close());
  await until(() => events.some(e => e.type === 'rejected' && e.status === 401));
  assert(!JSON.stringify(events).includes('secret-token'));
  await assert.rejects(rejected.respondUserInput({ threadId: 't', requestId: 'r', answers: {}, commandId: 'c' }).catch(e => { throw e; }), error => error.retryable === true);
});
