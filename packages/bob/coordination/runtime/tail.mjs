import { setTimeout as sleep } from 'node:timers/promises';
import { canonical } from './coordinator.mjs';
import { bindingFor } from './execution-port.mjs';
import { connect as t3Connect, RESUBSCRIBING } from './t3-client.mjs';
import { answersMatch } from './input.mjs';

/**
 * Tail relay (BOB-80, BOB-75 Phase 3). Runs inside the worker next to the coordinator.
 * t3 protocol: docs/plans/2026-11-15-t3-ws-protocol.html (§ numbers below).
 *
 * For every live attempt (admitted, current, item running or waiting-input) it follows
 * the attempt's t3 thread (ExecutionAdmission.thread) over the environment binding that
 * matches the attempt's target, plus one shell stream per binding:
 *  - shell pendingRuntimeRequest {kind:user_input} (not userOnly) whose runtime request is
 *    pending and resumable (not not_resumable), with its user_input_request turn item
 *    → coordinator.recordPendingInput (§3.3);
 *  - the item waits on a prompt that t3 no longer shows pending → clearPendingInput;
 *  - answers queued by ResolveInput → runtime-request.respond with a commandId stable per
 *    attempt+prompt (§3.4), settled once in coordination_input_delivery;
 *  - assistant_message / reasoning / command_execution text → the last TAIL_LIMITS lines,
 *    POSTed as TailFrame[] to <edge origin>/api/sdlc/tail (ephemeral; dropped on failure).
 * Streams end when the attempt leaves running/waiting-input. Answer text, question text
 * and tokens are never logged.
 */
/** Mirrors TAIL_LIMITS in packages/bob/src/sdlc-view/src/attempt.ts. */
export const TAIL_LIMITS = Object.freeze({ maxLines: 40, maxLineChars: 200, maxFramesPerPost: 50 });
/** The edge refuses larger tail bodies (413): MAX_TAIL_BYTES in apps/bob/worker/sdlc/tail.ts. */
export const MAX_TAIL_BYTES = 256 * 1024;
/** Unchanged tails are re-sent this often so the edge does not mark them stale (it waits 60 s). */
const TAIL_KEEPALIVE_MS = 30_000;
const TAIL_ITEM_TYPES = new Set(['assistant_message', 'reasoning', 'command_execution']);
const MAX_TURN_ITEMS = 400;
const clamp = (text, max) => typeof text === 'string' ? text.slice(0, max) : undefined;
/** After a failed recordPendingInput, the prompt is recorded again no sooner than this. */
const RECORD_RETRY_MS = 10_000;

// Whole escape sequences (CSI, OSC, DCS/SOS/PM/APC in 7- and 8-bit forms, two-byte ESC
// forms), then any other C0/C1 control character. Mirrors stripTerminalControls in
// packages/bob/src/sdlc-view/src/attempt.ts.
const ESCAPE_SEQUENCES = /(?:\u001b\[|\u009b)[\u0030-\u003f]*[\u0020-\u002f]*[\u0040-\u007e]?|(?:\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?|\u001b[\u0020-\u002f]*[\u0030-\u007e]?/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029]/g;
/** Agent-controlled text made terminal-safe: no escape sequences, no C0/C1 controls but tab.
 * multiline keeps LF (CR/CRLF become LF); otherwise line breaks become spaces. */
export function sanitizeText(text, { multiline = false } = {}) {
  if (typeof text !== 'string') return text;
  const parts = text.replace(LINE_BREAKS, multiline ? '\n' : ' ').split(multiline ? '\n' : /(?!)/);
  return parts.map(part => part.replace(ESCAPE_SEQUENCES, '').replace(CONTROL_CHARS, '')).join('\n');
}
/** Single-line sanitized text clamped to max, or undefined when nothing is left. */
const field = (text, max) => { const v = clamp(sanitizeText(text), max); return v ? v : undefined; };

/** TailFrame lines from turn items (§3.1 "Where readable output lives"), oldest first. */
export function tailLines(turnItems) {
  const lines = [];
  const items = [...turnItems].filter(item => TAIL_ITEM_TYPES.has(item?.type)).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  for (const item of items) {
    const text = item.type === 'command_execution'
      ? `$ ${item.input ?? ''}${Number.isInteger(item.exitCode) ? ` (exit ${item.exitCode})` : ''}`
      : typeof item.text === 'string' ? item.text : '';
    // Tabs become spaces (a tab would break the TUI's line layout).
    for (const line of sanitizeText(text, { multiline: true }).split('\n')) lines.push(line.replace(/\t/g, '  '));
  }
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines.slice(-TAIL_LIMITS.maxLines).map(line => line.length > TAIL_LIMITS.maxLineChars ? line.slice(0, TAIL_LIMITS.maxLineChars - 1) + '…' : line);
}

/** contract PendingInput from the shell request and its user_input_request turn item.
 * Display text (header, question, option labels and descriptions) is agent-controlled and
 * sanitized here (sanitizeText). An option without a value whose label sanitizing changed
 * keeps the original label as its value, so the answer t3 receives is still its label. */
export function pendingInputFrom(attemptId, request, item, createdAt) {
  return {
    attemptId, promptId: request.id, kind: 'user_input', createdAt,
    questions: (Array.isArray(item.questions) ? item.questions : []).slice(0, 20).map(q => {
      const header = field(q?.header, 240);
      return {
        id: q?.id, ...(header ? { header } : {}),
        question: clamp(sanitizeText(q?.question, { multiline: true }), 8000) || '(no question text)',
        options: (Array.isArray(q?.options) ? q.options : []).slice(0, 50).map(o => {
          const label = field(o?.label, 2000) ?? '(option)', description = field(o?.description, 4000);
          const value = o?.value ? clamp(o.value, 2000) : typeof o?.label === 'string' && o.label.length <= 2000 && o.label !== label ? o.label : undefined;
          return { label, ...(value ? { value } : {}), ...(description ? { description } : {}) };
        }),
        multiSelect: q?.multiSelect === true,
      };
    }),
  };
}

export function tailRelay({ coordinator, bindings, edge = null, connect = t3Connect, fetch: send = fetch, now = Date.now, tickMs = 1000, postIntervalMs = 2000, retryMs = 15_000, log = line => console.log(JSON.stringify(line)) }) {
  if (!Array.isArray(bindings)) throw new Error('Tail relay needs environment bindings');
  if (!Number.isInteger(postIntervalMs) || postIntervalMs < 100 || postIntervalMs > 60_000) throw new Error('Invalid tail post interval');
  const tailUrl = edge ? new URL('/api/sdlc/tail', new URL(edge.endpoint).origin).href : null;
  const say = fields => log({ at: new Date(now()).toISOString(), step: 'tail', ...fields });
  const connections = new Map(); // binding key → { client, threads: Map, synced, followers: Set, failedAt }
  const followers = new Map(); // attemptId → follower
  const cooldown = new Map(); // attemptId | binding key → retry time
  const inflight = new Set();
  let lastPost = 0, closed = false;

  function connection(binding) {
    const key = canonical({ baseUrl: binding.baseUrl, authToken: binding.authToken ?? '' });
    let conn = connections.get(key);
    if (conn) return conn;
    if ((cooldown.get(key) ?? 0) > now()) return null;
    let client;
    try { client = connect({ baseUrl: binding.baseUrl, authToken: binding.authToken, onEvent: event => say({ outcome: `t3-${event.type}`, ...(event.status ? { status: event.status } : {}) }) }); }
    catch (error) { cooldown.set(key, now() + retryMs); say({ outcome: 't3-configuration-invalid', code: error?.code ?? 'Error', message: String(error?.message ?? '').slice(0, 300) }); return null; }
    conn = { key, client, threads: new Map(), synced: false, followers: new Set() };
    connections.set(key, conn);
    const shell = conn.shell = client.subscribeShell();
    (async () => {
      for await (const item of shell) {
        if (item.kind === RESUBSCRIBING) conn.synced = false;
        else if (item.kind === 'snapshot' && !item.resolvedRepositoryIdentityRoots && Array.isArray(item.snapshot?.threads)) conn.threads = new Map(item.snapshot.threads.map(thread => [thread.id, thread]));
        else if (item.kind === 'synchronized') conn.synced = true;
        else if (item.kind === 'thread.updated' && item.thread?.id) conn.threads.set(item.thread.id, item.thread);
        else if (item.kind === 'thread.removed') conn.threads.delete(item.threadId);
        else continue;
        for (const follower of conn.followers) { follower.dirty ||= follower.status !== threadStatus(follower); evaluate(follower); }
      }
    })().catch(error => say({ outcome: 'shell-failed', code: error?.code ?? 'Error' })).finally(() => {
      if (closed || connections.get(key) !== conn) return;
      dropConnection(conn); cooldown.set(key, now() + retryMs);
    });
    return conn;
  }
  function dropConnection(conn) {
    connections.delete(conn.key);
    for (const follower of conn.followers) stop(follower);
    conn.shell.close(); conn.client.close();
  }
  const threadStatus = follower => String(follower.conn.threads.get(follower.threadId)?.status ?? 'unknown').slice(0, 64) || 'unknown';

  function follow(live) {
    if ((cooldown.get(live.attemptId) ?? 0) > now()) return;
    let binding;
    try { binding = bindingFor(bindings, live.target); }
    catch { cooldown.set(live.attemptId, now() + retryMs); say({ outcome: 'no-binding', attemptId: live.attemptId }); return; }
    const conn = connection(binding);
    if (!conn) return;
    const follower = { ...live, threadId: live.thread.threadId, conn, requests: new Map(), items: new Map(), synced: false, recorded: null, recordRetryAt: 0, dirty: true, status: 'unknown', lastSent: 0, frame: null };
    follower.stream = conn.client.subscribeThread(follower.threadId);
    followers.set(live.attemptId, follower); conn.followers.add(follower);
    say({ outcome: 'follow', attemptId: live.attemptId, itemId: live.itemId });
    (async () => {
      for await (const item of follower.stream) {
        if (item.kind === RESUBSCRIBING) { follower.synced = false; continue; }
        if (item.kind === 'snapshot' && item.projection) {
          const projection = item.projection;
          follower.requests = new Map((projection.runtimeRequests ?? []).map(r => [r.id, r]));
          follower.items = new Map([...(projection.turnItems ?? []), ...(projection.visibleTurnItems ?? [])].filter(i => i?.id).map(i => [i.id, i]));
          follower.dirty = true;
        } else if (item.kind === 'synchronized') follower.synced = true;
        else if (item.kind === 'event' && item.event?.type === 'runtime-request.updated' && item.event.payload?.id) follower.requests.set(item.event.payload.id, item.event.payload);
        else if (item.kind === 'event' && item.event?.type === 'turn-item.updated' && item.event.payload?.id) {
          follower.items.set(item.event.payload.id, item.event.payload);
          if (TAIL_ITEM_TYPES.has(item.event.payload.type)) follower.dirty = true;
          if (follower.items.size > MAX_TURN_ITEMS) prune(follower);
        } else continue; // unknown kinds and event types (§3.1): ignored
        evaluate(follower);
      }
    })().catch(error => say({ outcome: 'thread-failed', attemptId: live.attemptId, code: error?.code ?? 'Error' })).finally(() => {
      if (followers.get(live.attemptId) !== follower) return;
      stop(follower); cooldown.set(live.attemptId, now() + retryMs);
    });
  }
  function prune(follower) {
    const keep = [...follower.items.values()].sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0)).slice(0, MAX_TURN_ITEMS / 2);
    const questions = [...follower.items.values()].filter(i => i.type === 'user_input_request');
    follower.items = new Map([...keep, ...questions].map(i => [i.id, i]));
  }
  function stop(follower) {
    if (followers.get(follower.attemptId) === follower) followers.delete(follower.attemptId);
    follower.conn.followers.delete(follower);
    follower.stream.close();
  }

  /** Pending-input transitions for one follower; acts only on synchronized state. */
  function evaluate(follower) {
    if (!follower.synced || !follower.conn.synced || followers.get(follower.attemptId) !== follower) return;
    const request = follower.conn.threads.get(follower.threadId)?.pendingRuntimeRequest ?? null;
    const runtime = request ? follower.requests.get(request.id) : undefined;
    // Never auto-answerable (§6 "Who answers"): userOnly, not_resumable, or not pending.
    const answerable = request?.kind === 'user_input' && request.userOnly !== true && runtime?.status === 'pending' && runtime.responseCapability?.type !== 'not_resumable';
    const question = answerable ? [...follower.items.values()].find(i => i.type === 'user_input_request' && i.requestId === request.id) : undefined;
    try {
      if (question) {
        if (follower.recorded === request.id || follower.recordRetryAt > now()) return;
        let result;
        try {
          result = coordinator.recordPendingInput({ attemptId: follower.attemptId, pendingInput: pendingInputFrom(follower.attemptId, request, question, request.createdAt ?? runtime.createdAt) });
        } catch (error) {
          // Not recorded: retry after a short cooldown (tick re-evaluates once it passes).
          follower.recorded = null; follower.recordRetryAt = now() + RECORD_RETRY_MS;
          throw error;
        }
        follower.recorded = request.id; follower.recordRetryAt = 0;
        if (result.changed) { follower.state = 'waiting-input'; follower.promptId = request.id; say({ outcome: 'waiting-input', attemptId: follower.attemptId, promptId: request.id }); }
        return;
      }
      const waiting = follower.state === 'waiting-input' ? follower.promptId : null;
      if (!waiting) return;
      // Still pending (its records not all seen yet): leave it. Gone, resolved, userOnly or
      // not_resumable: the item cannot be answered from Bob any more.
      if (request?.id === waiting && (runtime === undefined || answerable)) return;
      const result = coordinator.clearPendingInput({ attemptId: follower.attemptId, promptId: waiting });
      follower.state = 'running'; follower.promptId = null; follower.recorded = null;
      if (result.changed) say({ outcome: 'input-cleared', attemptId: follower.attemptId, promptId: waiting });
    } catch (error) {
      say({ outcome: 'pending-input-error', attemptId: follower.attemptId, code: error?.code ?? 'Error' });
    }
  }

  /** Whether t3 still shows the prompt pending; null when unknown (not followed or not synchronized). */
  function promptPending(delivery) {
    const follower = followers.get(delivery.attemptId);
    if (!follower?.synced || !follower.conn.synced) return null;
    const request = follower.conn.threads.get(delivery.threadId)?.pendingRuntimeRequest;
    const runtime = follower.requests.get(delivery.promptId);
    if (runtime && runtime.status !== 'pending') return { pending: false, runtime };
    return { pending: request?.id === delivery.promptId, runtime };
  }

  /** The questions of the prompt's user_input_request turn item, when the follower has it. */
  const questionsFor = (follower, promptId) =>
    [...follower.items.values()].find(i => i.type === 'user_input_request' && i.requestId === promptId)?.questions ?? [];

  async function deliver() {
    for (const delivery of coordinator.pendingInputDeliveries({ now: now() })) {
      if (inflight.has(delivery.id)) continue;
      if (!delivery.live) { coordinator.settleInputDelivery(delivery.id, 'abandoned', 'attempt-ended'); say({ outcome: 'answer-abandoned', attemptId: delivery.attemptId, reason: 'attempt-ended' }); continue; }
      const follower = followers.get(delivery.attemptId);
      if (!follower) { coordinator.deferInputDelivery(delivery.id, { now: now(), code: 'NotFollowed' }); continue; }
      const seen = promptPending(delivery);
      if (seen && !seen.pending) {
        // Resolved on t3 already: ours (a delivery whose ack or settlement was lost) when t3
        // recorded our answers, otherwise someone answered elsewhere. The runtime request
        // does not carry the t3 commandId (spec §3.3), so ownership is by answers: every key
        // of ours, with our value or the label of the option our value names.
        const ours = seen.runtime?.status === 'resolved' && answersMatch(seen.runtime.answers, delivery.answers, questionsFor(follower, delivery.promptId));
        coordinator.settleInputDelivery(delivery.id, ours ? 'delivered' : 'abandoned', ours ? null : 'resolved-elsewhere');
        say({ outcome: ours ? 'answer-delivered' : 'answer-abandoned', attemptId: delivery.attemptId, ...(ours ? {} : { reason: 'resolved-elsewhere' }) });
        continue;
      }
      // Only answer what t3 is known to show pending: wait (not a failed try) until the
      // thread and shell streams are synchronized on a live socket.
      if (!seen || !follower.conn.client.connected) continue;
      inflight.add(delivery.id);
      try {
        await follower.conn.client.respondUserInput({ threadId: delivery.threadId, requestId: delivery.promptId, answers: delivery.answers, commandId: delivery.t3CommandId });
        coordinator.settleInputDelivery(delivery.id, 'delivered');
        say({ outcome: 'answer-delivered', attemptId: delivery.attemptId, promptId: delivery.promptId });
      } catch (error) {
        const code = String(error?.code ?? 'Error').slice(0, 128);
        if (error?.retryable === false) {
          // A declared t3 failure (Fail) is final: retrying the same command cannot succeed.
          // The ResolveInput Operation fails with the code, and the still-pending prompt can
          // be recorded and answered again.
          coordinator.settleInputDelivery(delivery.id, 'abandoned', code);
          say({ outcome: 'answer-abandoned', attemptId: delivery.attemptId, reason: 'rejected', code });
          follower.recorded = null; follower.recordRetryAt = 0; evaluate(follower);
        } else {
          coordinator.deferInputDelivery(delivery.id, { now: now(), code });
          say({ outcome: 'answer-retry', attemptId: delivery.attemptId, code });
        }
      } finally { inflight.delete(delivery.id); }
    }
  }

  async function postTails() {
    if (!tailUrl || now() - lastPost < postIntervalMs) return;
    const frames = [], at = new Date(now()).toISOString();
    for (const follower of followers.values()) {
      if (!follower.synced) continue;
      const status = threadStatus(follower);
      if (!follower.dirty && follower.status === status && now() - follower.lastSent < TAIL_KEEPALIVE_MS) continue;
      const lines = tailLines(follower.items.values());
      frames.push({ follower, status, frame: { itemId: follower.itemId, attemptId: follower.attemptId, threadId: follower.threadId, lines, threadStatus: status, at } });
    }
    if (!frames.length) return;
    // At most maxFramesPerPost frames and MAX_TAIL_BYTES per POST; the rest wait for the next one.
    const batch = [];
    for (const entry of frames.slice(0, TAIL_LIMITS.maxFramesPerPost)) {
      if (Buffer.byteLength(JSON.stringify({ frames: [...batch, entry].map(e => e.frame) })) > MAX_TAIL_BYTES - 1024) break;
      batch.push(entry);
    }
    lastPost = now();
    for (const { follower, status } of batch) { follower.dirty = false; follower.status = status; follower.lastSent = lastPost; }
    try {
      const response = await send(tailUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${edge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: batch.map(e => e.frame) }) });
      await response.body?.cancel();
      if (!response.ok) say({ outcome: 'tail-unavailable', status: response.status });
    } catch { say({ outcome: 'tail-unavailable' }); } // ephemeral: dropped, the next change re-sends
  }

  async function tick() {
    if (closed) return;
    const live = coordinator.liveAttempts();
    const ids = new Set(live.map(attempt => attempt.attemptId));
    for (const follower of [...followers.values()]) {
      if (!ids.has(follower.attemptId)) { stop(follower); say({ outcome: 'unfollow', attemptId: follower.attemptId }); }
    }
    for (const attempt of live) {
      const follower = followers.get(attempt.attemptId);
      if (!follower) follow(attempt);
      else if (follower.state !== attempt.state || follower.promptId !== attempt.promptId) {
        if (follower.promptId !== attempt.promptId) follower.recorded = null;
        follower.state = attempt.state; follower.promptId = attempt.promptId; evaluate(follower);
      } else if (follower.recordRetryAt && follower.recordRetryAt <= now()) { follower.recordRetryAt = 0; evaluate(follower); }
    }
    for (const conn of [...connections.values()]) if (!conn.followers.size) dropConnection(conn);
    for (const [key, until] of cooldown) if (until <= now()) cooldown.delete(key);
    await deliver();
    await postTails();
  }

  return {
    tick,
    async run({ signal } = {}) {
      say({ outcome: 'start' });
      while (!signal?.aborted && !closed) {
        try { await tick(); } catch (error) { say({ outcome: 'error', code: error?.code ?? 'Error' }); }
        try { await sleep(tickMs, undefined, { signal }); } catch { break; }
      }
    },
    get following() { return [...followers.keys()]; },
    close() {
      closed = true;
      for (const conn of [...connections.values()]) dropConnection(conn);
    },
  };
}

