import { randomUUID } from 'node:crypto';
import { Coordinator, supportedOperations, validators, outputValidators, canonical, digest, fail } from './coordinator.mjs';
const executionOperations = ['RequestExecution', 'RetryItem', 'RecordExecutionReceipt'];
export class ExecutionCoordinator extends Coordinator {
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
  storeSnapshot(snapshot, operationId) {
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
    const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'reserved', currentAttemptId: request.attemptId, execution: null, achievedMilestones: [], operationIds: [...snapshot.operationIds.slice(-99), operationId], evidenceRefs: [] };
    this.db.prepare('INSERT INTO coordination_attempt (tenant,id,owner,plan_id,item_id,request_id,operation_id,request,state,last_sequence) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(this.tenant, request.attemptId, this.owner, plan.id, request.itemId, request.requestId, operationId, canonical(request), 'queued', 0);
    this.storeSnapshot(next, operationId);
    const operation = { contractVersion: '1', operationId, commandId, state: 'accepted', resourceId: request.itemId, resourceVersion: next.resourceVersion, error: null };
    this.db.prepare('INSERT INTO coordination_operation VALUES (?,?,?,?)').run(this.tenant, operationId, this.owner, canonical(operation));
    return operation;
  }
  call(name, input, options = {}) {
    if (!executionOperations.includes(name)) return super.call(name, input, options);
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
        const { snapshot, plan } = this.item(body.itemId); itemId = body.itemId;
        if (snapshot.resourceVersion !== body.expectedVersion) fail('VersionConflict', 'Item version changed');
        if (snapshot.currentAttemptId !== body.previousAttemptId) fail('InvalidTransition', 'Retry does not name the current attempt');
        const previousAttempt = this.attempt(body.previousAttemptId);
        if (previousAttempt.state !== 'terminal') fail('ExecutionUnknown', 'Previous execution must be confirmed terminal');
        if (!['failed', 'cancelled'].includes(snapshot.state)) fail('InvalidTransition', 'Only failed/cancelled work can be retried');
        const request = { ...JSON.parse(previousAttempt.request), requestId: randomUUID(), attemptId: randomUUID(), planVersion: plan.version };
        this.db.prepare('UPDATE coordination_item SET snapshot=? WHERE tenant=? AND owner=? AND id=?').run(canonical({ ...snapshot, state: 'ready' }), this.tenant, this.owner, itemId);
        value = this.reserve(request, body.commandId);
      } else { itemId = body.itemId; value = this.reserve(body, body.requestId); }
      this.fault('after-execution-state');
      this.db.prepare('INSERT INTO forge_receipt VALUES (?,?,?,?,?,?,?)').run(this.tenant, namespace, key, hash, 200, canonical({ itemId, value }), new Date().toISOString());
      this.fault('before-execution-commit');
      return value;
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
    if (snapshot.currentAttemptId === attempt.id) {
      const completeAtExecution = definition.items.find(item => item.itemId === attempt.item_id).completionTarget === 'execution';
      const state = receipt.outcome === 'succeeded' ? (completeAtExecution ? 'completed' : 'validating') : receipt.outcome;
      const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state, achievedMilestones: receipt.outcome === 'succeeded' ? ['execution-succeeded'] : [], evidenceRefs: receipt.evidenceRefs };
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
  async dispatchOne(port, { now = Date.now(), leaseMs = 60000 } = {}) {
    if (!Number.isSafeInteger(now) || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) fail('InvalidRequest', 'Invalid dispatch lease', 400);
    const token = randomUUID();
    const attempt = this.transaction(() => {
      const candidates = this.db.prepare("SELECT * FROM coordination_attempt WHERE tenant=? AND owner=? AND state IN ('queued','dispatching','unknown') AND (lease_until IS NULL OR lease_until<=?) ORDER BY rowid LIMIT 100")
        .all(this.tenant, this.owner, now);
      const row = candidates.find(candidate => this.plan(candidate.plan_id).state === 'active');
      if (!row) return null;
      this.item(row.item_id);
      this.db.prepare("UPDATE coordination_attempt SET state='dispatching',lease_owner=?,lease_until=? WHERE tenant=? AND id=?").run(token, now + leaseMs, this.tenant, row.id);
      return row;
    });
    if (!attempt) return { dispatched: false };
    const request = JSON.parse(attempt.request);
    let admission;
    try {
      await port.requireCapabilities(request);
      if (attempt.state !== 'queued') admission = await port.find(request);
      if (!admission) admission = await port.submit(request);
      if (!validators.get('SubmitExecution')(request) || !outputValidators.get('SubmitExecution')(admission)) fail('TargetMismatch', 'Admission does not match the ForgeC schema');
      if (admission.requestId !== request.requestId || admission.attemptId !== request.attemptId || canonical(admission.target) !== canonical(request.target) || admission.thread.environmentId !== request.target.environmentId || admission.thread.projectId !== request.target.projectId) fail('TargetMismatch', 'Environment admission identity mismatch');
    } catch (error) {
      this.transaction(() => {
        const current = this.attempt(attempt.id); if (current.lease_owner !== token || current.state === 'terminal') return;
        this.db.prepare("UPDATE coordination_attempt SET state='unknown',lease_owner=NULL,lease_until=? WHERE tenant=? AND id=?").run(now + leaseMs, this.tenant, attempt.id);
        const { snapshot } = this.item(attempt.item_id);
        this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'execution-unknown' }, randomUUID());
      });
      return { dispatched: false, attemptId: attempt.id, state: 'unknown', error: { code: error.code ?? 'EnvironmentUnavailable', message: error.message } };
    }
    return this.transaction(() => {
      const current = this.attempt(attempt.id);
      if (current.lease_owner !== token || current.state === 'terminal') return { dispatched: false, attemptId: attempt.id, state: 'lease-lost' };
      this.db.prepare("UPDATE coordination_attempt SET state='admitted',admission=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?").run(canonical(admission), this.tenant, attempt.id);
      const { snapshot } = this.item(attempt.item_id);
      this.storeSnapshot({ ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state: 'running', execution: admission }, randomUUID());
      const operation = JSON.parse(this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(this.tenant, attempt.operation_id).receipt);
      this.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical({ ...operation, state: 'running' }), this.tenant, attempt.operation_id);
      return { dispatched: true, attemptId: attempt.id, admission };
    });
  }
}
