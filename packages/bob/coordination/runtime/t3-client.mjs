import WebSocket from 'ws';

/**
 * Minimal Node client for the t3 server's WebSocket RPC (BOB-80, BOB-75 Phase 3).
 * Spec: docs/plans/2026-11-15-t3-ws-protocol.html. Section numbers below refer to it.
 *
 * - One JSON message (or array of messages) per text frame; envelopes tagged by `_tag` (§2).
 * - Every Chunk is Acked at once, before its values are handled (§2.4).
 * - Ping keepalive; a socket silent for idleTimeoutMs is dropped (§2.5).
 * - Reconnects with jittered exponential backoff and resubscribes each live stream
 *   with afterSequence = the last sequence it saw, dropping the replay overlap (§4).
 * - Unknown message tags, stream item kinds and fields are ignored.
 *
 * The bearer token is sent only as the upgrade's Authorization header and never logged.
 */
export class T3RpcError extends Error {
  constructor(code, message, { retryable = false } = {}) { super(message); this.code = code; this.retryable = retryable; }
}

const wsUrl = baseUrl => {
  const url = new URL('/ws', baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new T3RpcError('InvalidRequest', 'Invalid t3 base URL');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('orchestrationProtocol', '2'); // §1.1: required, else HTTP 426
  return url;
};

/** Exit.cause → error (§2.3). A declared failure (Fail) is final; Die/Interrupt are not. */
function causeError(cause) {
  const entries = Array.isArray(cause) ? cause : [cause];
  const failure = entries.find(entry => entry?._tag === 'Fail');
  if (failure) return new T3RpcError(String(failure.error?._tag ?? 'Fail').slice(0, 128), String(failure.error?.message ?? 't3 request failed').slice(0, 500));
  if (entries.some(entry => entry?._tag === 'Interrupt')) return new T3RpcError('Interrupted', 't3 interrupted the request', { retryable: true });
  return new T3RpcError('Defect', 't3 could not run the request', { retryable: true });
}

/** Resume cursors (§4). Returns the item's sequence, or null when it carries none. */
const threadSequence = item => item?.kind === 'event' && Number.isSafeInteger(item.sequence) ? item.sequence : null;
const shellSequence = item => typeof item?.kind === 'string' && /^(thread|project)\./.test(item.kind) && Number.isSafeInteger(item.sequence) ? item.sequence : null;
const threadSnapshotCursor = item => item?.kind === 'snapshot' && Number.isSafeInteger(item.snapshotSequence) ? item.snapshotSequence : null;
// A shell snapshot with resolvedRepositoryIdentityRoots is enrichment only, not authoritative (§3.2).
const shellSnapshotCursor = item => item?.kind === 'snapshot' && !item.resolvedRepositoryIdentityRoots && Number.isSafeInteger(item.snapshot?.snapshotSequence) ? item.snapshot.snapshotSequence : null;

/** Synthetic stream item yielded before a stream is resubscribed after a reconnect. */
export const RESUBSCRIBING = 't3-client.resubscribing';

export function connect({ baseUrl, authToken, WebSocketImpl = WebSocket, pingMs = 10_000, idleTimeoutMs = 30_000, backoff = { initialMs: 500, maxMs: 30_000 }, requestTimeoutMs = 15_000, random = Math.random, onEvent = () => {} }) {
  const url = wsUrl(baseUrl);
  if (typeof authToken !== 'string' || authToken.length < 1) throw new T3RpcError('InvalidRequest', 'A t3 bearer token is required');
  let ws = null, open = false, closed = false, nextId = 1, failures = 0, lastFrame = 0, timer = null, reconnectTimer = null;
  const pending = new Map(); // requestId → { onChunk?, onExit, onDrop }
  const subscriptions = new Set();
  const openWaiters = new Set();

  const send = message => { if (open) ws.send(JSON.stringify(message)); };

  function handle(message) {
    if (message?._tag === 'Chunk') {
      send({ _tag: 'Ack', requestId: message.requestId }); // §2.4: once per Chunk, immediately
      pending.get(message.requestId)?.onChunk?.(Array.isArray(message.values) ? message.values : []);
    } else if (message?._tag === 'Exit') {
      const handler = pending.get(message.requestId);
      pending.delete(message.requestId);
      handler?.onExit(message.exit ?? {});
    } else if (message?._tag === 'Defect') {
      // §2.3: ends every pending request on this socket. Reconnect and resume.
      onEvent({ type: 'defect' });
      ws.terminate();
    } // Pong and unknown tags: nothing to do.
  }

  function dial() {
    if (closed) return;
    const socket = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${authToken}` } });
    ws = socket;
    socket.on('open', () => {
      if (socket !== ws) return;
      open = true; lastFrame = Date.now();
      onEvent({ type: 'connected' });
      timer = setInterval(() => {
        if (Date.now() - lastFrame > idleTimeoutMs) { onEvent({ type: 'idle-timeout' }); socket.terminate(); return; }
        send({ _tag: 'Ping' });
      }, pingMs);
      timer.unref?.();
      for (const sub of subscriptions) sub.start();
      for (const resolve of openWaiters) resolve();
      openWaiters.clear();
    });
    socket.on('message', data => {
      if (socket !== ws) return;
      lastFrame = Date.now(); failures = 0;
      let parsed;
      try { parsed = JSON.parse(String(data)); } catch { return; }
      for (const message of [].concat(parsed)) handle(message);
    });
    socket.on('unexpected-response', (_request, response) => {
      onEvent({ type: 'rejected', status: response.statusCode });
      response.resume();
      socket.terminate();
    });
    socket.on('error', () => {}); // 'close' follows
    socket.on('close', () => {
      if (socket !== ws) return;
      const wasOpen = open;
      open = false; clearInterval(timer); timer = null;
      const handlers = [...pending.values()]; pending.clear();
      for (const handler of handlers) handler.onDrop();
      if (wasOpen) onEvent({ type: 'disconnected' });
      if (closed) return;
      const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** Math.min(failures++, 16)) * (0.5 + random() / 2);
      reconnectTimer = setTimeout(dial, delay);
      reconnectTimer.unref?.();
    });
  }

  function whenOpen(timeoutMs) {
    if (open) return Promise.resolve();
    if (closed) return Promise.reject(new T3RpcError('Closed', 't3 client is closed'));
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(() => { openWaiters.delete(done); reject(new T3RpcError('Unavailable', 't3 is not connected', { retryable: true })); }, timeoutMs);
      openWaiters.add(done);
    });
  }

  /** Unary request (§2.2/§2.3): resolves with the Exit Success value. */
  async function call(tag, payload, timeoutMs = requestTimeoutMs) {
    await whenOpen(timeoutMs);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => { pending.delete(id); send({ _tag: 'Interrupt', requestId: id }); reject(new T3RpcError('Timeout', 't3 did not answer in time', { retryable: true })); }, timeoutMs);
      pending.set(id, {
        onExit: exit => { clearTimeout(t); exit._tag === 'Success' ? resolve(exit.value ?? null) : reject(causeError(exit.cause)); },
        onDrop: () => { clearTimeout(t); reject(new T3RpcError('Disconnected', 't3 connection closed during the request', { retryable: true })); },
      });
      send({ _tag: 'Request', id, tag, payload, headers: [] });
    });
  }

  /** A resumable stream subscription as an AsyncIterable of stream items. */
  function stream(tag, basePayload, { afterSequence, sequenceOf, snapshotCursorOf }) {
    const queue = [];
    let waiter = null, done = false, error = null, requestId = null, cursor = Number.isSafeInteger(afterSequence) ? afterSequence : null, started = false;
    const wake = () => { const w = waiter; waiter = null; w?.(); };
    const sub = {
      start() {
        if (done || !open) return;
        if (started) queue.push({ kind: RESUBSCRIBING });
        started = true;
        const id = requestId = nextId++;
        pending.set(id, {
          onChunk: values => {
            for (const value of values) {
              const sequence = sequenceOf(value);
              if (sequence !== null) {
                if (cursor !== null && sequence <= cursor) continue; // replay overlap (§4)
                cursor = sequence;
              }
              const snapshotCursor = snapshotCursorOf(value);
              if (snapshotCursor !== null) cursor = snapshotCursor;
              queue.push(value);
            }
            wake();
          },
          onExit: exit => {
            requestId = null;
            if (exit._tag !== 'Success') error = causeError(exit.cause);
            finish();
          },
          onDrop: () => { requestId = null; wake(); }, // resubscribed on reconnect
        });
        send({ _tag: 'Request', id, tag, payload: { ...basePayload, ...(cursor !== null ? { afterSequence: cursor } : {}) }, headers: [] });
        wake();
      },
      end() { finish(); },
    };
    function finish() {
      if (done) return;
      done = true; subscriptions.delete(sub);
      if (requestId !== null) { pending.delete(requestId); send({ _tag: 'Interrupt', requestId }); requestId = null; }
      wake();
    }
    subscriptions.add(sub);
    sub.start();
    return {
      get cursor() { return cursor; },
      [Symbol.asyncIterator]() {
        return {
          async next() {
            for (;;) {
              if (queue.length) return { value: queue.shift(), done: false };
              if (error) { const e = error; error = null; throw e; }
              if (done) return { value: undefined, done: true };
              await new Promise(resolve => { waiter = resolve; });
            }
          },
          async return() { finish(); queue.length = 0; return { value: undefined, done: true }; },
        };
      },
      close: finish,
    };
  }

  dial();
  return {
    /** §3.1. Bounded snapshot, completion marker; no compact encodings. */
    subscribeThread(threadId, { afterSequence } = {}) {
      return stream('orchestration.subscribeThread', { threadId, requestCompletionMarker: true, acceptBoundedSnapshot: true }, { afterSequence, sequenceOf: threadSequence, snapshotCursorOf: threadSnapshotCursor });
    },
    /** §3.2. Only fields the deployed server understands. */
    subscribeShell({ afterSequence } = {}) {
      return stream('orchestration.subscribeShell', { requestCompletionMarker: true }, { afterSequence, sequenceOf: shellSequence, snapshotCursorOf: shellSnapshotCursor });
    },
    /** §3.4. commandId must be reused on retry so t3 treats it as one command. */
    respondUserInput({ threadId, requestId, answers, commandId }) {
      return call('orchestration.dispatchCommand', { type: 'runtime-request.respond', commandId, threadId, requestId, answers });
    },
    get connected() { return open; },
    close() {
      closed = true; clearTimeout(reconnectTimer);
      for (const sub of [...subscriptions]) sub.end();
      if (ws) { if (open) send({ _tag: 'Eof' }); ws.close(); }
    },
  };
}
