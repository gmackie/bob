import { randomUUID } from 'node:crypto';
import { Coordinator, supportedOperations, validators, outputValidators, pendingInputValidator, canonical, digest, fail } from './coordinator.mjs';
import { decodeAnswers, t3Answers, inputCommandId } from './input.mjs';
import { openRelease, requestRelease, requestDeployment } from './release.mjs';
const executionOperations = ['RequestExecution', 'RetryItem', 'CancelItem', 'ReconcileItem', 'ResolveInput', 'RecordExecutionReceipt', 'RequestRelease', 'RequestDeployment'];
/** The receipt's evidence plus `commit:<sha>` (BOB-80: the edge reads the attempt's commit
 * for CI detail), deduplicated, appended last, within the contract's 100-entry limit. */
export function evidenceWithCommit(refs, commitSha) {
  if (!/^[a-f0-9]{40}$/.test(commitSha ?? '')) return refs;
  const ref = `commit:${commitSha}`;
  return [...[...new Set(refs)].filter(entry => entry !== ref).slice(-99), ref];
}
// Item states the tail relay follows: the attempt's t3 thread is live.
const liveStates = new Set(['running', 'waiting-input']);
// Item states CancelItem accepts. Terminal states and `cancelling` refuse it.
const cancellableStates = new Set(['pending', 'ready', 'reserved', 'running', 'waiting-input', 'execution-unknown', 'validating', 'review', 'deploying']);
/** Operations that admit issue scope and therefore need a resolved issue when an
 * issue resolver is configured. */
export const issueAdmissionOperations = Object.freeze(['CreatePlan', 'UpdatePlan', 'RequestExecution', 'RetryItem']);
// Only admit() can produce this proof; hosts cannot pass it through JSON.
const verifiedIssues = Symbol('verifiedIssues');
export class ExecutionCoordinator extends Coordinator {
  /** issueResolver(issueRef, policy) → snapshot is optional. When absent, admission
   * behaves exactly as before; when present, issue-admitting operations must go
   * through admit(), which resolves each issue outside the SQLite transaction. */
  constructor(options) {
    super(options);
    this.issueResolver = options.issueResolver ?? null;
  }
  admissionIssues(name, body) {
    const key = name === 'RequestExecution' ? body.requestId : body.commandId;
    if (this.db.prepare('SELECT 1 FROM forge_receipt WHERE tenant=? AND operation=? AND key=?').get(this.tenant, `coordination:${this.owner}`, key)) return [];
    if (name === 'CreatePlan' || name === 'UpdatePlan') return body.plan.items.map(item => item.issue);
    const { definition } = this.item(body.itemId);
    return [definition.items.find(item => item.itemId === body.itemId).issue];
  }
  /** Async admission entry point used by the CLI and HTTP host. Replays and other
   * operations go straight to call(). Network resolution never holds a lock. */
  async admit(name, input, options = {}) {
    if (!this.issueResolver || !issueAdmissionOperations.includes(name)) return this.call(name, input, options);
    let issues = [];
    try {
      const body = JSON.parse(JSON.stringify(input));
      if (validators.get(name)(body)) issues = this.admissionIssues(name, body);
    } catch { /* call() reports the canonical validation/authorization error */ }
    const verified = new Set();
    for (const issue of issues) {
      const key = canonical(issue);
      if (verified.has(key)) continue;
      await this.issueResolver(issue, this.context);
      verified.add(key);
    }
    return this.call(name, input, { ...options, [verifiedIssues]: verified });
  }
  verifyAdmission(name, body, options) {
    if (!this.issueResolver || !issueAdmissionOperations.includes(name)) return;
    const issues = name === 'CreatePlan' || name === 'UpdatePlan' ? body.plan.items.map(item => item.issue)
      : [this.item(body.itemId).definition.items.find(item => item.itemId === body.itemId).issue];
    const verified = options[verifiedIssues];
    if (!(verified instanceof Set) || issues.some(issue => !verified.has(canonical(issue)))) fail('IssueUnverified', 'The issue must resolve in Kanbanger within the trusted policy before admission', 409);
  }
  /** Lifecycle effect for Kanbanger, written in the caller's transaction. */
  issueEffect(attemptId, fact, payload) {
    this.db.prepare('INSERT INTO coordination_issue_effect (tenant,id,owner,attempt_id,fact,payload,status,delivery_attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(this.tenant, `${attemptId}:${fact}`, this.owner, attemptId, fact, canonical({ fact, ...payload }), 'pending', 0, 0, new Date().toISOString());
  }
  item(id) {
    const row = this.db.prepare('SELECT * FROM coordination_item WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, id);
    if (!row) fail('NotFound', 'Item not found', 404);
    const plan = this.plan(row.plan_id), definition = JSON.parse(plan.definition);
    this.authorize(definition);
    return { row, plan, definition, snapshot: JSON.parse(row.snapshot) };
  }
  attempt(id) {
    const row = this.db.prepare('SELECT * FROM coordination_attempt WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, id);
    if (!row) fail('NotFound', 'Attempt not found', 404);
    this.item(row.item_id); return row;
  }
  /** pendingInput exists only while the item is waiting-input: every other state drops it. */
  storeSnapshot(snapshot, operationId) {
    if (snapshot.state !== 'waiting-input' && 'pendingInput' in snapshot) { snapshot = { ...snapshot }; delete snapshot.pendingInput; }
    this.db.prepare('UPDATE coordination_item SET snapshot=?,version=? WHERE tenant=? AND owner=? AND id=?')
      .run(canonical(snapshot), snapshot.resourceVersion, this.tenant, this.owner, snapshot.itemId);
    this.event(snapshot.itemId, snapshot.resourceVersion, operationId);
  }
  reserve(request, commandId) {
    const { plan, definition, snapshot } = this.item(request.itemId);
    const declared = definition.items.find(item => item.itemId === request.itemId);
    if (plan.id !== request.planId || plan.version !== request.planVersion) fail('VersionConflict', 'Plan snapshot changed');
    if (declared.issueSnapshotRef !== request.issueSnapshotRef || canonical(declared.target) !== canonical(request.target)) fail('TargetMismatch', 'Request differs from admitted issue/target snapshot');
    if (plan.state !== 'active' || snapshot.state !== 'ready') fail('InvalidTransition', 'Item must be ready in an active plan');
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM coordination_attempt WHERE tenant=? AND owner=? AND plan_id=? AND state != 'terminal'").get(this.tenant, this.owner, plan.id).n;
    if (count >= definition.concurrencyLimit) fail('CapacityUnavailable', 'Plan execution capacity is reserved');
    const collision = this.db.prepare('SELECT id FROM coordination_attempt WHERE tenant=? AND (id=? OR request_id=?)').get(this.tenant, request.attemptId, request.requestId);
    if (collision) fail('IdempotencyConflict', 'Attempt or request ID is already admitted');
    const operationId = randomUUID();
    const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'reserved', currentAttemptId: request.attemptId, execution: null, release: null, achievedMilestones: [], operationIds: [...snapshot.operationIds.slice(-99), operationId], evidenceRefs: [] };
    this.db.prepare('INSERT INTO coordination_attempt (tenant,id,owner,plan_id,item_id,request_id,operation_id,request,state,last_sequence) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(this.tenant, request.attemptId, this.owner, plan.id, request.itemId, request.requestId, operationId, canonical(request), 'queued', 0);
    this.storeSnapshot(next, operationId);
    this.issueEffect(request.attemptId, 'admitted', { issue: declared.issue, planId: plan.id, itemId: request.itemId, requestId: request.requestId, attemptId: request.attemptId, environmentId: request.target.environmentId, executionProfileId: request.executionProfileId });
    const operation = { contractVersion: '1', operationId, commandId, state: 'accepted', resourceId: request.itemId, resourceVersion: next.resourceVersion, error: null };
    this.db.prepare('INSERT INTO coordination_operation VALUES (?,?,?,?)').run(this.tenant, operationId, this.owner, canonical(operation));
    return operation;
  }
  /** BOB-88: each retry gets its own branch, `<first attempt's branch>-a<N>` where N is
   * the new attempt's 1-based number for the item, so the environment never collides
   * with the branch an earlier attempt created. The base is always the first attempt's
   * branch (never an already-suffixed one); a base too long for the contract's 240
   * characters is truncated, never the suffix. */
  retryBranch(itemId) {
    const first = this.db.prepare('SELECT request FROM coordination_attempt WHERE tenant=? AND owner=? AND item_id=? ORDER BY rowid LIMIT 1').get(this.tenant, this.owner, itemId);
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM coordination_attempt WHERE tenant=? AND owner=? AND item_id=?').get(this.tenant, this.owner, itemId);
    const suffix = `-a${n + 1}`, base = JSON.parse(first.request).workspace.branch;
    return base.length + suffix.length <= 240 ? base + suffix : base.slice(0, 240 - suffix.length).replace(/[/.]+$/, '') + suffix;
  }
  execute(name, input, options = {}) {
    if (!executionOperations.includes(name)) return super.execute(name, input, options);
    let body;
    try { body = JSON.parse(JSON.stringify(input)); } catch { fail('InvalidRequest', 'Input must be JSON', 400); }
    if (!validators.get(name)(body)) fail('InvalidRequest', 'Input does not match the ForgeC schema', 400);
    const key = name === 'RequestExecution' ? body.requestId : name === 'RecordExecutionReceipt' ? body.eventId : body.commandId;
    if (name !== 'RecordExecutionReceipt' && options.idempotencyKey !== key) fail('InvalidRequest', 'Idempotency-Key differs from request/command ID', 400);
    if (name === 'RecordExecutionReceipt' && this.context.receiptEnvironmentId !== body.environmentId) fail('Forbidden', 'Receipt environment must come from trusted authentication', 403);
    return this.transaction(() => {
      const namespace = name === 'RecordExecutionReceipt' ? `receipt:${this.owner}` : `coordination:${this.owner}`;
      const hash = digest({ name, body });
      const previous = this.db.prepare('SELECT request_hash,response FROM forge_receipt WHERE tenant=? AND operation=? AND key=?').get(this.tenant, namespace, key);
      if (previous) {
        if (previous.request_hash !== hash) fail(name === 'RecordExecutionReceipt' ? 'ReceiptConflict' : 'IdempotencyConflict', 'ID has a different payload');
        const stored = JSON.parse(previous.response); this.item(stored.itemId); return stored.value;
      }
      let value, itemId;
      if (name === 'RecordExecutionReceipt') {
        const attempt = this.attempt(body.attemptId); itemId = attempt.item_id;
        value = this.receive(attempt, body);
      } else if (name === 'RetryItem') {
        this.verifyAdmission(name, body, options);
        const { snapshot, plan } = this.item(body.itemId); itemId = body.itemId;
        if (snapshot.resourceVersion !== body.expectedVersion) fail('VersionConflict', 'Item version changed');
        if (snapshot.currentAttemptId !== body.previousAttemptId) fail('InvalidTransition', 'Retry does not name the current attempt');
        const previousAttempt = this.attempt(body.previousAttemptId);
        if (previousAttempt.state !== 'terminal') fail('ExecutionUnknown', 'Previous execution must be confirmed terminal');
        if (!['failed', 'cancelled'].includes(snapshot.state)) fail('InvalidTransition', 'Only failed/cancelled work can be retried');
        const previousRequest = JSON.parse(previousAttempt.request);
        const request = { ...previousRequest, requestId: randomUUID(), attemptId: randomUUID(), planVersion: plan.version, workspace: { ...previousRequest.workspace, branch: this.retryBranch(itemId) } };
        this.db.prepare('UPDATE coordination_item SET snapshot=? WHERE tenant=? AND owner=? AND id=?').run(canonical({ ...snapshot, state: 'ready' }), this.tenant, this.owner, itemId);
        value = this.reserve(request, body.commandId);
        // BOB-88: the superseded attempt's release (checks-failed, blocked or already
        // retired) is due now, so the release driver retires it and closes its open PR.
        // Schedule only: the row's data and lease are the driver's.
        this.db.prepare('UPDATE coordination_release SET next_check_at=0 WHERE tenant=? AND owner=? AND id=?').run(this.tenant, this.owner, previousAttempt.id);
      } else if (name === 'CancelItem') {
        itemId = body.itemId; value = this.cancelItem(body);
      } else if (name === 'ReconcileItem') {
        itemId = body.itemId; value = this.reconcileItem(body);
      } else if (name === 'ResolveInput') {
        ({ itemId, value } = this.resolveInput(body, options));
      } else if (name === 'RequestRelease') {
        ({ itemId, value } = requestRelease(this, body, options));
      } else if (name === 'RequestDeployment') {
        itemId = body.itemId; value = requestDeployment(this, body, options);
      } else { itemId = body.itemId; this.verifyAdmission(name, body, options); value = this.reserve(body, body.requestId); }
      this.fault('after-execution-state');
      this.db.prepare('INSERT INTO forge_receipt VALUES (?,?,?,?,?,?,?)').run(this.tenant, namespace, key, hash, 200, canonical({ itemId, value }), new Date().toISOString());
      if (name !== 'RecordExecutionReceipt') this.logCommand(name, key, options, { resourceId: itemId, operationId: value.operationId, outcome: value.state });
      this.fault('before-execution-commit');
      return value;
    });
  }
  operation(commandId, state, snapshot) {
    const operation = { contractVersion: '1', operationId: randomUUID(), commandId, state, resourceId: snapshot.itemId, resourceVersion: snapshot.resourceVersion, error: null };
    this.db.prepare('INSERT INTO coordination_operation VALUES (?,?,?,?)').run(this.tenant, operation.operationId, this.owner, canonical(operation));
    return operation;
  }
  /** Ends a never-submitted attempt as cancelled, releasing its capacity. */
  closeCancelled(attempt, reason) {
    this.db.prepare("UPDATE coordination_attempt SET state='terminal',terminal=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?")
      .run(canonical({ outcome: 'cancelled', reason }), this.tenant, attempt.id);
    const op = JSON.parse(this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, attempt.operation_id).receipt);
    this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...op, state: 'cancelled' }), this.tenant, attempt.operation_id);
  }
  /** cancelling → cancelled, and the CancelItem operation that asked for it succeeds.
   * Milestones already achieved stay true, as on the immediate cancel path. The log is
   * append-only: completion is a new 'succeeded' row beside the 'accepted' one. */
  finishCancel(snapshot, extra = {}) {
    const next = { ...snapshot, ...extra, resourceVersion: snapshot.resourceVersion + 1, state: 'cancelled' };
    this.storeSnapshot(next, randomUUID());
    const pending = this.db.prepare(`SELECT a.command_id,a.owner,a.actor,a.operation_id FROM coordination_command_log a WHERE a.tenant=? AND a.owner=? AND a.operation='CancelItem' AND a.resource_id=? AND a.outcome='accepted'
      AND NOT EXISTS (SELECT 1 FROM coordination_command_log b WHERE b.tenant=a.tenant AND b.command_id=a.command_id AND b.operation='CancelItem' AND b.outcome='succeeded')`).all(this.tenant, this.owner, snapshot.itemId);
    for (const row of pending) {
      const op = this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, row.operation_id);
      if (op) this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...JSON.parse(op.receipt), state: 'succeeded', resourceVersion: next.resourceVersion }), this.tenant, row.operation_id);
      this.logCommand('CancelItem', row.command_id, {}, { resourceId: snapshot.itemId, operationId: row.operation_id, outcome: 'succeeded', owner: row.owner, actor: row.actor });
    }
    return next;
  }
  /** CancelItem. No environment cancellation port exists yet (CancelExecution is
   * contract-only), so an execution that may already exist is never abandoned:
   * the item moves to `cancelling` and the worker settles it. A never-submitted
   * (queued) attempt and items without a live attempt cancel at once. */
  cancelItem(body) {
    const { snapshot } = this.item(body.itemId);
    if (snapshot.resourceVersion !== body.expectedVersion) fail('VersionConflict', 'Item version changed');
    if (!cancellableStates.has(snapshot.state)) fail('InvalidTransition', 'Item cannot be cancelled in this state');
    const attempt = snapshot.currentAttemptId ? this.attempt(snapshot.currentAttemptId) : null;
    if (attempt && attempt.state !== 'terminal' && attempt.state !== 'queued') {
      const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'cancelling' };
      const operation = this.operation(body.commandId, 'accepted', next);
      next.operationIds = [...snapshot.operationIds.slice(-99), operation.operationId];
      this.storeSnapshot(next, operation.operationId);
      return operation;
    }
    if (attempt?.state === 'queued') this.closeCancelled(attempt, `CancelItem ${body.commandId}`);
    // Milestones already achieved stay true; dependents they readied are unaffected.
    const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'cancelled' };
    const operation = this.operation(body.commandId, 'succeeded', next);
    next.operationIds = [...snapshot.operationIds.slice(-99), operation.operationId];
    this.storeSnapshot(next, operation.operationId);
    return operation;
  }
  /** ReconcileItem: only for execution-unknown. Reuses the worker's existing
   * recovery (dispatchOne: FindExecution, then replay of the identical request
   * if the environment has none) by expiring the unknown attempt's back-off
   * lease so the next worker tick re-checks it. Item state is unchanged until the
   * worker learns the outcome, so repeating the command is harmless. */
  reconcileItem(body) {
    const { snapshot } = this.item(body.itemId);
    if (snapshot.state !== 'execution-unknown') fail('InvalidTransition', 'Only execution-unknown items can be reconciled');
    const attempt = this.attempt(snapshot.currentAttemptId);
    if (attempt.state === 'unknown') this.db.prepare('UPDATE coordination_attempt SET lease_until=NULL WHERE tenant=? AND id=? AND lease_owner IS NULL').run(this.tenant, attempt.id);
    return this.operation(body.commandId, 'accepted', snapshot);
  }
  /** ResolveInput (BOB-80): answers the current attempt's pending t3 question. The
   * item goes back to running and the answer is queued, in this transaction, in
   * coordination_input_delivery for the tail relay to send with t3
   * runtime-request.respond. The Operation stays `accepted` until the relay settles
   * the delivery (`succeeded`, or `failed` when it cannot be delivered).
   * options.expectItemId, set by the edge exporter, must name the attempt's item. */
  resolveInput(body, options) {
    const attempt = this.attempt(body.attemptId);
    const { snapshot } = this.item(attempt.item_id);
    if (options.expectItemId !== undefined && options.expectItemId !== attempt.item_id) fail('InvalidTransition', 'The attempt does not belong to this item');
    if (snapshot.currentAttemptId !== attempt.id || attempt.state !== 'admitted') fail('InvalidTransition', 'The attempt is no longer current');
    const pending = snapshot.pendingInput;
    if (snapshot.state !== 'waiting-input' || !pending) fail('InvalidTransition', 'The item is not waiting for input');
    if (pending.promptId !== body.promptId || pending.attemptId !== attempt.id) fail('InvalidTransition', 'The question changed; reload it before answering');
    if (pending.kind !== 'user_input') fail('InvalidTransition', 'Only user_input questions can be answered from Bob');
    const answers = decodeAnswers(body.answer, pending);
    if (!answers) fail('InvalidRequest', 'The answer does not match the pending questions', 400);
    const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'running' };
    const operation = this.operation(body.commandId, 'accepted', next);
    next.operationIds = [...snapshot.operationIds.slice(-99), operation.operationId];
    this.storeSnapshot(next, operation.operationId);
    const admission = JSON.parse(attempt.admission);
    // One live delivery per prompt (unique attempt_id, prompt_id): an abandoned one is
    // replaced by this new answer; a pending or delivered one means it was answered.
    if (this.db.prepare("SELECT 1 FROM coordination_input_delivery WHERE tenant=? AND attempt_id=? AND prompt_id=? AND status IN ('pending','delivered')").get(this.tenant, attempt.id, pending.promptId)) fail('InvalidTransition', 'The question was already answered');
    this.db.prepare("DELETE FROM coordination_input_delivery WHERE tenant=? AND attempt_id=? AND prompt_id=? AND status='abandoned'").run(this.tenant, attempt.id, pending.promptId);
    this.db.prepare('INSERT INTO coordination_input_delivery (tenant,id,owner,attempt_id,item_id,thread_id,prompt_id,command_id,operation_id,answers,status,delivery_attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(this.tenant, `${attempt.id}:${pending.promptId}`, this.owner, attempt.id, attempt.item_id, admission.thread.threadId, pending.promptId, body.commandId, operation.operationId, canonical(t3Answers(answers, pending)), 'pending', 0, 0, new Date().toISOString());
    return { itemId: attempt.item_id, value: operation };
  }
  // ---- Internal tail-relay operations (BOB-80). Host-only: not in the contract,
  // not HTTP- or MCP-exposed, not relayable from the edge. ----
  /** Attempts whose t3 thread the relay follows: admitted, current, item running or waiting-input. */
  liveAttempts() {
    const rows = this.db.prepare("SELECT * FROM coordination_attempt WHERE tenant=? AND owner=? AND state='admitted' ORDER BY rowid").all(this.tenant, this.owner);
    const live = [];
    for (const row of rows) {
      let snapshot;
      try { ({ snapshot } = this.item(row.item_id)); } catch (error) { if (error.code === 'Forbidden' || error.code === 'NotFound') continue; throw error; }
      if (snapshot.currentAttemptId !== row.id || !liveStates.has(snapshot.state)) continue;
      const admission = JSON.parse(row.admission);
      live.push({ itemId: row.item_id, attemptId: row.id, target: JSON.parse(row.request).target, thread: admission.thread, state: snapshot.state, promptId: snapshot.pendingInput?.promptId ?? null });
    }
    return live;
  }
  /** The relay saw a user_input request on the attempt's thread. Only the item's current
   * running attempt moves to waiting-input; the same promptId again is a no-op, a new
   * one replaces it, and a prompt with a pending or delivered answer is never re-recorded. */
  recordPendingInput({ attemptId, pendingInput }) {
    if (!pendingInputValidator(pendingInput) || pendingInput.attemptId !== attemptId) fail('InvalidRequest', 'Pending input does not match the contract', 400);
    return this.transaction(() => {
      const attempt = this.attempt(attemptId), { snapshot } = this.item(attempt.item_id);
      if (snapshot.currentAttemptId !== attemptId || attempt.state !== 'admitted' || !liveStates.has(snapshot.state)) return { changed: false, reason: 'not-running' };
      // Answered = a delivery still pending or delivered. An abandoned one (not delivered) lets
      // the still-pending prompt be recorded and answered again.
      if (this.db.prepare("SELECT 1 FROM coordination_input_delivery WHERE tenant=? AND attempt_id=? AND prompt_id=? AND status IN ('pending','delivered')").get(this.tenant, attemptId, pendingInput.promptId)) return { changed: false, reason: 'answered' };
      if (snapshot.state === 'waiting-input' && snapshot.pendingInput?.promptId === pendingInput.promptId) return { changed: false, reason: 'unchanged' };
      this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'waiting-input', pendingInput: JSON.parse(canonical(pendingInput)) }, randomUUID());
      return { changed: true };
    });
  }
  /** The prompt was resolved without Bob (e.g. answered in the T3 UI): back to running. */
  clearPendingInput({ attemptId, promptId }) {
    return this.transaction(() => {
      const attempt = this.attempt(attemptId), { snapshot } = this.item(attempt.item_id);
      if (snapshot.currentAttemptId !== attemptId || snapshot.state !== 'waiting-input' || snapshot.pendingInput?.promptId !== promptId) return { changed: false };
      this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'running' }, randomUUID());
      return { changed: true };
    });
  }
  /** Queued answers due for delivery. `live` is false once the attempt ended or was replaced. */
  pendingInputDeliveries({ now = Date.now(), limit = 20 } = {}) {
    return this.db.prepare("SELECT d.*, a.request, a.state AS attempt_state FROM coordination_input_delivery d JOIN coordination_attempt a ON a.tenant=d.tenant AND a.id=d.attempt_id WHERE d.tenant=? AND d.owner=? AND d.status='pending' AND d.next_attempt_at<=? ORDER BY d.created_at, d.id LIMIT ?")
      .all(this.tenant, this.owner, now, limit).map(row => {
        let current = false;
        try { current = this.item(row.item_id).snapshot.currentAttemptId === row.attempt_id; } catch (error) { if (error.code !== 'Forbidden' && error.code !== 'NotFound') throw error; }
        return { id: row.id, attemptId: row.attempt_id, itemId: row.item_id, threadId: row.thread_id, promptId: row.prompt_id, t3CommandId: inputCommandId(row.attempt_id, row.prompt_id, row.command_id),
          answers: JSON.parse(row.answers), target: JSON.parse(row.request).target, deliveryAttempts: row.delivery_attempts, live: current && row.attempt_state === 'admitted' };
      });
  }
  /** A failed delivery waits (capped exponential back-off) and is retried. Only an error code is kept. */
  deferInputDelivery(id, { now = Date.now(), code = 'Unavailable' } = {}) {
    this.transaction(() => {
      const row = this.db.prepare("SELECT delivery_attempts FROM coordination_input_delivery WHERE tenant=? AND owner=? AND id=? AND status='pending'").get(this.tenant, this.owner, id);
      if (!row) return;
      this.db.prepare('UPDATE coordination_input_delivery SET delivery_attempts=?,next_attempt_at=?,last_error=? WHERE tenant=? AND id=?')
        .run(row.delivery_attempts + 1, now + Math.min(1000 * 2 ** Math.min(row.delivery_attempts, 6), 60000), String(code).slice(0, 128), this.tenant, id);
    });
  }
  /** delivered → the ResolveInput Operation succeeds; abandoned (reason code) → it fails.
   * The answer text is erased either way, and the log gains a completion row. */
  settleInputDelivery(id, outcome, reason = null) {
    if (!['delivered', 'abandoned'].includes(outcome)) fail('InvalidRequest', 'Unknown delivery outcome', 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM coordination_input_delivery WHERE tenant=? AND owner=? AND id=? AND status='pending'").get(this.tenant, this.owner, id);
      if (!row) return { changed: false };
      this.db.prepare('UPDATE coordination_input_delivery SET status=?,answers=NULL,last_error=?,settled_at=? WHERE tenant=? AND id=?')
        .run(outcome, reason === null ? null : String(reason).slice(0, 128), new Date().toISOString(), this.tenant, id);
      const op = this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, row.operation_id);
      const state = outcome === 'delivered' ? 'succeeded' : 'failed';
      if (op) this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...JSON.parse(op.receipt), state,
        error: state === 'failed' ? { code: 'InputNotDelivered', message: `The answer was not delivered to t3 (${String(reason ?? 'unknown').slice(0, 100)})`, retryable: false } : null }), this.tenant, row.operation_id);
      const accepted = this.db.prepare("SELECT actor FROM coordination_command_log WHERE tenant=? AND command_id=? AND operation='ResolveInput' AND outcome='accepted' ORDER BY rowid LIMIT 1").get(this.tenant, row.command_id);
      this.logCommand('ResolveInput', row.command_id, {}, { resourceId: row.item_id, operationId: row.operation_id, outcome: state, owner: row.owner, actor: accepted?.actor ?? null });
      return { changed: true };
    });
  }
  afterPlanWrite(planId) { this.readyDependents(planId); }
  query(name, body) {
    if (name === 'GetCapabilities') return { ...super.query(name, body), operations: [...supportedOperations, ...executionOperations] };
    return super.query(name, body);
  }
  receive(attempt, receipt) {
    const request = JSON.parse(attempt.request), admission = attempt.admission ? JSON.parse(attempt.admission) : null;
    if (!admission) fail('ExecutionUnknown', 'Recover admission before reconciling a terminal receipt');
    if (receipt.environmentId !== request.target.environmentId || receipt.executionId !== admission.executionId || canonical(receipt.thread) !== canonical(admission.thread) || canonical(receipt.sourceSnapshot.repository) !== canonical(request.target.repository)) fail('ReceiptConflict', 'Receipt identity differs from the admitted execution');
    if (receipt.sourceSnapshot.dirty && !receipt.sourceSnapshot.patchArtifactRef) fail('ReceiptConflict', 'Dirty source requires a patch artifact');
    if (attempt.state === 'terminal') fail('ReceiptConflict', 'Attempt already has a terminal receipt');
    if (receipt.sequence !== attempt.last_sequence + 1) fail('SequenceGap', 'Recover the missing execution receipt sequence');
    this.db.prepare("UPDATE coordination_attempt SET state='terminal',terminal=?,last_sequence=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?")
      .run(canonical(receipt), receipt.sequence, this.tenant, attempt.id);
    const { snapshot, definition } = this.item(attempt.item_id);
    const source = receipt.sourceSnapshot;
    this.issueEffect(attempt.id, `execution-${receipt.outcome}`, { issue: definition.items.find(item => item.itemId === attempt.item_id).issue, planId: attempt.plan_id, itemId: attempt.item_id, requestId: attempt.request_id, attemptId: attempt.id,
      environmentId: receipt.environmentId, executionId: receipt.executionId, thread: receipt.thread, commitSha: source.commitSha, treeDigest: source.treeDigest, dirty: source.dirty, patchArtifactRef: source.patchArtifactRef ?? null,
      occurredAt: receipt.occurredAt, evidenceRefs: receipt.evidenceRefs, currentAttempt: snapshot.currentAttemptId === attempt.id });
    if (snapshot.currentAttemptId === attempt.id && snapshot.state === 'cancelling') {
      const next = this.finishCancel(snapshot, { evidenceRefs: evidenceWithCommit(receipt.evidenceRefs, source.commitSha) });
      const op = JSON.parse(this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, attempt.operation_id).receipt);
      this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...op, state: receipt.outcome, resourceVersion: next.resourceVersion }), this.tenant, attempt.operation_id);
    } else if (snapshot.currentAttemptId === attempt.id) {
      const completeAtExecution = definition.items.find(item => item.itemId === attempt.item_id).completionTarget === 'execution';
      const state = receipt.outcome === 'succeeded' ? (completeAtExecution ? 'completed' : 'validating') : receipt.outcome;
      // BOB-82: a succeeded attempt that must reach review, merge or production gets a release.
      const release = receipt.outcome === 'succeeded' && !completeAtExecution ? openRelease(this, { attempt, request, receipt, definition }) : null;
      const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state, release, achievedMilestones: receipt.outcome === 'succeeded' ? ['execution-succeeded'] : [], evidenceRefs: evidenceWithCommit(receipt.evidenceRefs, release?.headSha ?? source.commitSha) };
      this.storeSnapshot(next, randomUUID());
      const op = JSON.parse(this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, attempt.operation_id).receipt);
      this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...op, state: receipt.outcome, resourceVersion: next.resourceVersion }), this.tenant, attempt.operation_id);
      this.readyDependents(attempt.plan_id);
    }
    return { contractVersion: '1', eventId: receipt.eventId, acceptedSequence: receipt.sequence };
  }
  readyDependents(planId) {
    const plan = this.plan(planId); if (plan.state !== 'active') return;
    const definition = JSON.parse(plan.definition);
    const rows = this.db.prepare('SELECT snapshot FROM coordination_item WHERE tenant=? AND owner=? AND plan_id=?').all(this.tenant, this.owner, planId);
    const items = new Map(rows.map(row => { const s = JSON.parse(row.snapshot); return [s.itemId, s]; }));
    for (const snapshot of items.values()) {
      if (snapshot.state !== 'pending') continue;
      const dependencies = definition.dependencies.filter(edge => edge.downstreamItemId === snapshot.itemId);
      if (dependencies.every(edge => items.get(edge.upstreamItemId).achievedMilestones.includes(edge.requiredMilestone))) this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'ready' }, randomUUID());
    }
  }
  /** Network work is deliberately outside the SQLite transaction. Expired leases
   * reconcile admission before replaying the exact request, never a new attempt. */
  /** Whether the worker may take up an attempt: its plan is active, or its item is
   * cancelling. A cancelling item settles even in a paused plan; that path only
   * looks the execution up and never submits one, so a paused plan starts no work. */
  dispatchable(attempt) {
    return this.plan(attempt.plan_id).state === 'active' || this.item(attempt.item_id).snapshot.state === 'cancelling';
  }
  async dispatchOne(port, { now = Date.now(), leaseMs = 60000, admit } = {}) {
    if (!Number.isSafeInteger(now) || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) fail('InvalidRequest', 'Invalid dispatch lease', 400);
    // Optional admission gate (BOB-76 budget governor): asked only before a
    // NEW submission. Recovering an unknown or dispatching attempt never waits,
    // since that execution already holds capacity.
    if (admit) {
      const next = this.db.prepare("SELECT * FROM coordination_attempt WHERE tenant=? AND owner=? AND state IN ('queued','dispatching','unknown') AND (lease_until IS NULL OR lease_until<=?) ORDER BY rowid LIMIT 100")
        .all(this.tenant, this.owner, now).find(candidate => this.dispatchable(candidate));
      if (next && next.state === 'queued' && !(await admit(JSON.parse(next.request)))) return { dispatched: false, state: 'budget-held' };
    }
    const token = randomUUID();
    const attempt = this.transaction(() => {
      const candidates = this.db.prepare("SELECT * FROM coordination_attempt WHERE tenant=? AND owner=? AND state IN ('queued','dispatching','unknown') AND (lease_until IS NULL OR lease_until<=?) ORDER BY rowid LIMIT 100")
        .all(this.tenant, this.owner, now);
      const row = candidates.find(candidate => this.dispatchable(candidate));
      if (!row) return null;
      this.item(row.item_id);
      this.db.prepare("UPDATE coordination_attempt SET state='dispatching',lease_owner=?,lease_until=? WHERE tenant=? AND id=?").run(token, now + leaseMs, this.tenant, row.id);
      return row;
    });
    if (!attempt) return { dispatched: false };
    const request = JSON.parse(attempt.request);
    let admission;
    try {
      const cancelling = this.item(attempt.item_id).snapshot.state === 'cancelling';
      if (!cancelling) await port.requireCapabilities(request);
      if (attempt.state !== 'queued') admission = await port.find(request);
      // A cancelled item never starts a new execution: absent one, cancel settles here.
      if (!admission && cancelling) return this.transaction(() => {
        const current = this.attempt(attempt.id);
        if (current.lease_owner !== token || current.state === 'terminal') return { dispatched: false, attemptId: attempt.id, state: 'lease-lost' };
        this.closeCancelled(current, 'No execution exists for a cancelled item');
        this.finishCancel(this.item(attempt.item_id).snapshot);
        this.readyDependents(attempt.plan_id);
        return { dispatched: false, attemptId: attempt.id, state: 'cancelled' };
      });
      if (!admission) admission = await port.submit(request);
      if (!validators.get('SubmitExecution')(request) || !outputValidators.get('SubmitExecution')(admission)) fail('TargetMismatch', 'Admission does not match the ForgeC schema');
      if (admission.requestId !== request.requestId || admission.attemptId !== request.attemptId || canonical(admission.target) !== canonical(request.target) || admission.thread.environmentId !== request.target.environmentId || admission.thread.projectId !== request.target.projectId) fail('TargetMismatch', 'Environment admission identity mismatch');
    } catch (error) {
      this.transaction(() => {
        const current = this.attempt(attempt.id); if (current.lease_owner !== token || current.state === 'terminal') return;
        this.db.prepare("UPDATE coordination_attempt SET state='unknown',lease_owner=NULL,lease_until=? WHERE tenant=? AND id=?").run(now + leaseMs, this.tenant, attempt.id);
        const { snapshot } = this.item(attempt.item_id);
        this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: snapshot.state === 'cancelling' ? 'cancelling' : 'execution-unknown' }, randomUUID());
      });
      return { dispatched: false, attemptId: attempt.id, state: 'unknown', error: { code: error.code ?? 'EnvironmentUnavailable', message: error.message } };
    }
    return this.transaction(() => {
      const current = this.attempt(attempt.id);
      if (current.lease_owner !== token || current.state === 'terminal') return { dispatched: false, attemptId: attempt.id, state: 'lease-lost' };
      this.db.prepare("UPDATE coordination_attempt SET state='admitted',admission=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?").run(canonical(admission), this.tenant, attempt.id);
      const { snapshot } = this.item(attempt.item_id);
      this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: snapshot.state === 'cancelling' ? 'cancelling' : 'running', execution: admission }, randomUUID());
      const operation = JSON.parse(this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, attempt.operation_id).receipt);
      this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...operation, state: 'running' }), this.tenant, attempt.operation_id);
      return { dispatched: true, attemptId: attempt.id, admission };
    });
  }
}
