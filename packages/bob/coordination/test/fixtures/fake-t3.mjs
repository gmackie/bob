import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { once } from 'node:events';

/**
 * A fake t3 server speaking the WebSocket RPC in docs/plans/2026-11-15-t3-ws-protocol.html,
 * strict about the parts the client must get right: /ws?orchestrationProtocol=2 (§1.1, else
 * 426), Bearer auth on upgrade (§1.2, else 401), `headers` array on every Request (§2.2) and
 * one Ack per Chunk before the next Chunk of that stream is sent (§2.4).
 *
 * It models just enough state for the relay: shell threads with pendingRuntimeRequest,
 * per-thread runtime requests and turn items, a global sequence, and
 * runtime-request.respond (§3.4).
 */
export async function fakeT3({ token = 'fake-t3-token', autoResolve = true } = {}) {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const state = { sequence: 100, threads: new Map(), responds: [], received: [], connections: new Set(), upgrades: [], respondError: null, respondDie: false, sendFrames: null };
  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://x');
    state.upgrades.push({ path: url.pathname, protocol: url.searchParams.get('orchestrationProtocol'), authorization: request.headers.authorization });
    const reject = (status, body) => { socket.end(`HTTP/1.1 ${status} X\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`); };
    if (url.pathname !== '/ws') return reject(404, '{}');
    if (url.searchParams.get('orchestrationProtocol') !== '2') return reject(426, '{"code":"orchestration_protocol_incompatible"}');
    if (request.headers.authorization !== `Bearer ${token}`) return reject(401, '{}');
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    const conn = { ws, streams: new Map(), shells: new Set(), threadSubs: new Map() };
    state.connections.add(conn);
    ws.on('close', () => state.connections.delete(conn));
    const raw = message => ws.readyState === 1 && ws.send(JSON.stringify(message));
    conn.raw = raw;
    // Flow control (§2.4): one unacked Chunk per stream.
    conn.chunk = (requestId, values) => {
      const stream = conn.streams.get(requestId);
      if (!stream) return;
      stream.queue.push(values);
      if (!stream.waiting) flush(requestId);
    };
    const flush = requestId => {
      const stream = conn.streams.get(requestId);
      if (!stream || stream.waiting || !stream.queue.length) return;
      stream.waiting = true; stream.sent++;
      raw({ _tag: 'Chunk', requestId, values: stream.queue.shift() });
    };
    ws.on('message', data => {
      for (const message of [].concat(JSON.parse(String(data)))) {
        state.received.push(message);
        if (message._tag === 'Ping') { raw({ _tag: 'Pong' }); continue; }
        if (message._tag === 'Ack') { const s = conn.streams.get(message.requestId); if (s) { s.waiting = false; s.acks++; flush(message.requestId); } continue; }
        if (message._tag === 'Interrupt') { conn.streams.delete(message.requestId); conn.shells.delete(message.requestId); conn.threadSubs.delete(message.requestId); continue; }
        if (message._tag !== 'Request') { raw({ _tag: 'Defect', defect: 'unknown tag' }); continue; }
        if (!Array.isArray(message.headers)) { raw({ _tag: 'Exit', requestId: message.id, exit: { _tag: 'Failure', cause: [{ _tag: 'Die', defect: 'headers required' }] } }); continue; }
        handleRequest(conn, message);
      }
    });
    if (state.sendFrames) for (const frame of state.sendFrames) raw(frame);
  });

  const threadShell = thread => ({ id: thread.id, projectId: 'project', title: 'Pilot', status: thread.status, pendingRuntimeRequest: thread.pending, updatedAt: '2026-11-15T10:00:00.000Z', futureField: 'ignored' });
  function handleRequest(conn, message) {
    const { id, tag, payload } = message;
    if (tag === 'orchestration.subscribeShell') {
      conn.streams.set(id, { queue: [], waiting: false, sent: 0, acks: 0 }); conn.shells.add(id);
      conn.chunk(id, [{ kind: 'snapshot', snapshot: { schemaVersion: 1, snapshotSequence: state.sequence, projects: [], threads: [...state.threads.values()].map(threadShell), archivedThreads: [] } }]);
      conn.chunk(id, [{ kind: 'snapshot', snapshot: { schemaVersion: 1, snapshotSequence: state.sequence, projects: [], threads: [], archivedThreads: [] }, resolvedRepositoryIdentityRoots: ['/repo'] }]);
      conn.chunk(id, [{ kind: 'synchronized' }]);
    } else if (tag === 'orchestration.subscribeThread') {
      const thread = state.threads.get(payload.threadId);
      if (!thread) { conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'OrchestrationV2ThreadNotFound', message: 'no thread' } }] } }); return; }
      conn.streams.set(id, { queue: [], waiting: false, sent: 0, acks: 0, threadId: payload.threadId }); conn.threadSubs.set(id, payload);
      const after = payload.afterSequence;
      const replay = Number.isSafeInteger(after) ? thread.events.filter(e => e.sequence > after - 1) : null; // overlap by one, like the real server can (§4)
      if (replay && after <= state.sequence) conn.chunk(id, replay.length ? replay : [{ kind: 'noop' }]);
      else conn.chunk(id, [{ kind: 'snapshot', snapshotSequence: state.sequence, projection: { thread: { id: thread.id }, runtimeRequests: [...thread.requests.values()], turnItems: [...thread.items.values()], unknownProjectionField: [] }, historyCursor: null, hasMoreHistory: false, latestLocalTurnOrdinal: 1 }]);
      conn.chunk(id, [{ kind: 'synchronized' }]);
    } else if (tag === 'orchestration.dispatchCommand' && payload?.type === 'runtime-request.respond') {
      state.responds.push(payload);
      const open = state.threads.get(payload.threadId)?.requests.get(payload.requestId);
      if (open?.status !== 'pending') { conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'OrchestrationV2DispatchCommandError', commandId: payload.commandId, commandType: payload.type, message: 'Runtime request is not pending' } }] } }); return; }
      if (state.respondDie) { conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Die', defect: 'transient' }] } }); return; }
      if (state.respondError) { conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'OrchestrationV2DispatchCommandError', commandId: payload.commandId, commandType: payload.type, message: state.respondError } }] } }); return; }
      if (autoResolve) api.resolve(payload.threadId, payload.requestId, payload.answers);
      conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Success', value: { sequence: state.sequence } } });
    } else {
      conn.raw({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Die', defect: 'unknown method' }] } });
    }
  }
  const event = (thread, type, entity) => {
    const item = { kind: 'event', sequence: ++state.sequence, event: { id: 'evt-' + state.sequence, threadId: thread.id, occurredAt: '2026-11-15T10:00:00.000Z', type, payload: entity } };
    thread.events.push(item);
    for (const conn of state.connections) for (const [id, sub] of conn.threadSubs) if (sub.threadId === thread.id) conn.chunk(id, [item]);
  };
  const shellUpdate = thread => {
    const item = { kind: 'thread.updated', sequence: ++state.sequence, location: 'active', thread: threadShell(thread) };
    for (const conn of state.connections) for (const id of conn.shells) conn.chunk(id, [item]);
  };
  const api = {
    state,
    url: null,
    addThread(threadId, { status = 'running', items = [] } = {}) {
      state.threads.set(threadId, { id: threadId, status, pending: null, requests: new Map(), items: new Map(items.map(i => [i.id, i])), events: [] });
    },
    /** Adds an assistant/reasoning/command item (or updates it). */
    item(threadId, item) { const t = state.threads.get(threadId); t.items.set(item.id, item); event(t, 'turn-item.updated', item); },
    ask(threadId, requestId, questions, { userOnly = false, capability = { type: 'live', providerSessionId: 'ps' } } = {}) {
      const t = state.threads.get(threadId);
      const request = { id: requestId, nodeId: 'node', providerTurnId: null, nativeRequestRef: null, kind: 'user_input', status: 'pending', responseCapability: capability, createdAt: '2026-11-15T10:00:00.000Z', resolvedAt: null };
      t.requests.set(requestId, request); event(t, 'runtime-request.updated', request);
      const item = { type: 'user_input_request', id: 'item-' + requestId, requestId, status: 'pending', ordinal: 50, questions };
      t.items.set(item.id, item); event(t, 'turn-item.updated', item);
      t.pending = { id: requestId, kind: 'user_input', createdAt: '2026-11-15T10:00:00.000Z', blocking: true, ...(userOnly ? { userOnly: true } : {}) };
      shellUpdate(t);
    },
    resolve(threadId, requestId, answers) {
      const t = state.threads.get(threadId);
      const request = { ...t.requests.get(requestId), status: 'resolved', resolvedAt: '2026-11-15T10:01:00.000Z', answers };
      t.requests.set(requestId, request); event(t, 'runtime-request.updated', request);
      if (t.pending?.id === requestId) { t.pending = null; shellUpdate(t); }
    },
    setStatus(threadId, status) { const t = state.threads.get(threadId); t.status = status; shellUpdate(t); },
    dropConnections() { for (const conn of state.connections) conn.ws.terminate(); },
    acks() { let n = 0; for (const m of state.received) if (m._tag === 'Ack') n++; return n; },
    async close() { for (const conn of state.connections) conn.ws.terminate(); wss.close(); http.close(); await once(http, 'close').catch(() => {}); },
  };
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  api.url = `http://127.0.0.1:${http.address().port}`;
  api.token = token;
  return api;
}
