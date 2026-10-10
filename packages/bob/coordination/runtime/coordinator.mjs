import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url)));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map(Object.values(schema.paths).flatMap(Object.values).filter(op => op.operationId)
  .map(op => [op.operationId.split('/').at(-1), ajv.compile(op.requestBody.content['application/json'].schema)]));
export const supportedOperations = Object.freeze(['CreatePlan', 'UpdatePlan', 'ControlPlan', 'GetPlan', 'GetItem', 'GetOperation', 'ReadEvents', 'GetCapabilities']);
const canonical = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export class CoordinationError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new CoordinationError(code, message, status); };
const milestones = ['execution-succeeded', 'review-ready', 'merged', 'production-verified'];
const completionTargets = ['execution', 'review-ready', 'merged', 'production'];

/** Trusted context is supplied by the host, never read from a command body. */
export class Coordinator {
  constructor({ database, context, fault = () => {} }) {
    if (![context?.workspaceId, context?.actorId].every(id => typeof id === 'string' && id.length >= 1 && id.length <= 128) || !Array.isArray(context.targets) || !Array.isArray(context.issueProjects)) {
      fail('Forbidden', 'A trusted workspace, actor and integration policy are required', 403);
    }
    this.context = structuredClone(context);
    this.fault = fault;
    this.db = new DatabaseSync(database);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version === 0) this.transaction(() => {
      if (this.db.prepare('PRAGMA user_version').get().user_version === 1) return;
      this.db.exec(readFileSync(new URL('../storage/generated/d1.sql', import.meta.url), 'utf8'));
      this.db.exec('PRAGMA user_version = 1');
    });
    else if (version !== 1) { this.db.close(); fail('StorageVersion', 'Unsupported coordination database version', 500); }
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get tenant() { return this.context.workspaceId; }
  get owner() { return this.context.actorId; }
  cursor(sequence) { return `v1.${digest([this.tenant, this.owner]).slice(0, 24)}.${sequence}`; }
  watermark() { return this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS seq FROM coordination_event WHERE tenant=?').get(this.tenant).seq; }
  parseCursor(cursor) {
    if (cursor == null) return 0;
    const prefix = this.cursor(0).slice(0, -1);
    const sequence = cursor.startsWith(prefix) ? cursor.slice(prefix.length) : '';
    if (!/^(0|[1-9][0-9]*)$/.test(sequence) || !Number.isSafeInteger(Number(sequence)) || Number(sequence) > this.watermark()) {
      fail('CursorExpired', 'Load a fresh snapshot before resuming events', 409);
    }
    return Number(sequence);
  }
  plan(id) {
    const row = this.db.prepare('SELECT * FROM coordination_plan WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, id);
    if (!row) fail('NotFound', 'Plan not found', 404);
    return row;
  }
  authorize(definition, origin) {
    for (const item of definition.items) {
      if (!this.context.targets.some(target => canonical(target) === canonical(item.target))) fail('Forbidden', 'Execution target is outside the trusted policy', 403);
      if (item.issue.workspaceId !== this.tenant || !this.context.issueProjects.some(project => ['integrationId', 'workspaceId', 'teamId', 'projectId'].every(key => project[key] === item.issue[key]))) fail('Forbidden', 'Issue project is outside the trusted policy', 403);
    }
    if (origin && !this.context.targets.some(target => target.environmentId === origin.environmentId && target.projectId === origin.projectId)) fail('Forbidden', 'Origin is outside the trusted policy', 403);
  }
  validateGraph(definition) {
    const items = new Map(definition.items.map(item => [item.itemId, item]));
    if (items.size !== definition.items.length) fail('InvalidGraph', 'Duplicate item IDs');
    const edges = new Map([...items.keys()].map(id => [id, []]));
    const seen = new Set();
    for (const dependency of definition.dependencies) {
      const { upstreamItemId: from, downstreamItemId: to, requiredMilestone } = dependency;
      if (!items.has(from) || !items.has(to) || from === to || seen.has(canonical([from, to]))) fail('InvalidGraph', 'Invalid or duplicate dependency');
      seen.add(canonical([from, to]));
      if (completionTargets.indexOf(items.get(from).completionTarget) < milestones.indexOf(requiredMilestone)) fail('InvalidGraph', 'Upstream completion target cannot satisfy the dependency');
      edges.get(from).push(to);
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      if (visiting.has(id)) fail('InvalidGraph', 'Dependency cycle');
      if (visited.has(id)) return;
      visiting.add(id); for (const next of edges.get(id)) visit(next); visiting.delete(id); visited.add(id);
    };
    for (const id of items.keys()) visit(id);
  }
  event(resourceId, resourceVersion, operationId) {
    const eventId = randomUUID(), sequence = this.watermark() + 1, recordedAt = new Date().toISOString();
    this.db.prepare('INSERT INTO coordination_event VALUES (?,?,?,?,?,?,?)').run(this.tenant, eventId, this.owner, resourceId, resourceVersion, sequence, recordedAt);
    const payload = { eventId, resourceId, resourceVersion, sequence, recordedAt };
    this.db.prepare('INSERT INTO forge_outbox (tenant,op_id,ordinal,channel,message,payload,status,attempts,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(this.tenant, operationId, sequence, 'coordination', 'ResourceChanged', canonical(payload), 'pending', 0, recordedAt);
  }
  writeItems(planId, definition, state, operationId, version) {
    const existing = this.db.prepare('SELECT id FROM coordination_item WHERE tenant=? AND owner=? AND plan_id=?').all(this.tenant, this.owner, planId);
    const ids = new Set(definition.items.map(item => item.itemId));
    // Item IDs are stable query identities: removing one in an edit requires a
    // tombstone protocol, which this first admission slice intentionally rejects.
    if (existing.some(item => !ids.has(item.id))) fail('InvalidGraph', 'Removing admitted items is not supported yet');
    for (const item of definition.items) {
      if (item.itemId === planId || this.db.prepare('SELECT id FROM coordination_plan WHERE tenant=? AND id=?').get(this.tenant, item.itemId)) fail('InvalidGraph', 'Item ID overlaps a plan identity');
      const collision = this.db.prepare('SELECT owner,plan_id FROM coordination_item WHERE tenant=? AND id=?').get(this.tenant, item.itemId);
      if (collision && (collision.owner !== this.owner || collision.plan_id !== planId)) fail('InvalidGraph', 'Item ID is already admitted');
      const itemState = state === 'cancelled' ? 'cancelled' : state === 'active' && !definition.dependencies.some(edge => edge.downstreamItemId === item.itemId) ? 'ready' : 'pending';
      const snapshot = { itemId: item.itemId, planId, resourceVersion: version, state: itemState, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [operationId], evidenceRefs: [] };
      this.db.prepare('INSERT INTO coordination_item (tenant,id,owner,plan_id,snapshot,version) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET snapshot=excluded.snapshot,version=excluded.version')
        .run(this.tenant, item.itemId, this.owner, planId, canonical(snapshot), version);
      this.event(item.itemId, version, operationId);
    }
  }
  call(name, input, { idempotencyKey } = {}) {
    if (!supportedOperations.includes(name)) fail('CapabilityUnavailable', 'Operation is not implemented in this slice', 501);
    // Normalize to actual JSON before hashing/validation; reject non-JSON input.
    let body;
    try { body = JSON.parse(JSON.stringify(input)); } catch { fail('InvalidRequest', 'Input must be JSON', 400); }
    const validate = validators.get(name);
    if (!validate(body)) fail('InvalidRequest', ajv.errorsText(validate.errors), 400);
    const mutation = ['CreatePlan', 'UpdatePlan', 'ControlPlan'].includes(name);
    if (mutation && idempotencyKey !== body.commandId) fail('InvalidRequest', 'Idempotency-Key must equal commandId', 400);
    return this.transaction(() => {
      if (!mutation) return this.query(name, body);
      const fingerprint = digest({ name, body }), namespace = `coordination:${this.owner}`;
      const previous = this.db.prepare('SELECT request_hash,response FROM forge_receipt WHERE tenant=? AND operation=? AND key=?').get(this.tenant, namespace, body.commandId);
      if (previous) {
        if (previous.request_hash !== fingerprint) fail('IdempotencyConflict', 'Command ID already has a different payload');
        const stored = JSON.parse(previous.response);
        // Recheck current access policy before revealing a historical receipt.
        this.authorize(stored.definition, stored.origin);
        return stored.operation;
      }
      const operationId = randomUUID();
      let planId, definition, state, version;
      if (name === 'CreatePlan') {
        planId = randomUUID(); definition = body.plan; state = 'draft'; version = 1;
      } else {
        const row = this.plan(body.planId);
        this.authorize(JSON.parse(row.definition), body.origin);
        if (row.version !== body.expectedVersion) fail('VersionConflict', 'Plan version changed');
        planId = row.id; definition = name === 'UpdatePlan' ? body.plan : JSON.parse(row.definition); version = row.version + 1;
        if (name === 'UpdatePlan') {
          if (!['draft', 'paused'].includes(row.state)) fail('InvalidTransition', 'Pause the plan before editing');
          state = row.state;
        } else {
          const transitions = { start: { draft: 'active' }, pause: { active: 'paused' }, resume: { paused: 'active' }, cancel: { draft: 'cancelled', active: 'cancelled', paused: 'cancelled' } };
          state = transitions[body.action]?.[row.state];
          if (!state) fail('InvalidTransition', 'Plan action is not legal in this state');
        }
      }
      this.authorize(definition, body.origin); this.validateGraph(definition);
      this.db.prepare('INSERT INTO coordination_plan (tenant,id,owner,definition,state,version) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET definition=excluded.definition,state=excluded.state,version=excluded.version')
        .run(this.tenant, planId, this.owner, canonical(definition), state, version);
      this.writeItems(planId, definition, state, operationId, version);
      this.event(planId, version, operationId);
      this.fault('after-state');
      const operation = { contractVersion: '1', operationId, commandId: body.commandId, state: 'succeeded', resourceId: planId, resourceVersion: version, error: null };
      this.db.prepare('INSERT INTO coordination_operation VALUES (?,?,?,?)').run(this.tenant, operationId, this.owner, canonical(operation));
      this.db.prepare('INSERT INTO forge_receipt VALUES (?,?,?,?,?,?,?)').run(this.tenant, namespace, body.commandId, fingerprint, 200, canonical({ operation, definition, origin: body.origin ?? null }), new Date().toISOString());
      this.fault('before-commit');
      return operation;
    });
  }
  query(name, body) {
    if (name === 'GetCapabilities') return { contractVersion: '1', operations: [...supportedOperations], executionProfiles: [], validationProfiles: [], eventResume: true };
    if (name === 'ReadEvents') {
      const sequence = this.parseCursor(body.cursor);
      const events = this.db.prepare('SELECT * FROM coordination_event WHERE tenant=? AND owner=? AND sequence>? ORDER BY sequence LIMIT ?').all(this.tenant, this.owner, sequence, body.limit)
        .map(row => ({ eventId: row.id, resourceId: row.resource_id, resourceVersion: row.resource_version, sequence: row.sequence, recordedAt: row.recorded_at }));
      for (const event of events) {
        const item = this.db.prepare('SELECT plan_id FROM coordination_item WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, event.resourceId);
        this.authorize(JSON.parse(this.plan(item?.plan_id ?? event.resourceId).definition));
      }
      return { contractVersion: '1', events, nextCursor: this.cursor(events.at(-1)?.sequence ?? this.watermark()) };
    }
    if (name === 'GetOperation') {
      const row = this.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, body.resourceId);
      if (!row) fail('NotFound', 'Operation not found', 404);
      const receipt = JSON.parse(row.receipt); this.authorize(JSON.parse(this.plan(receipt.resourceId).definition)); return receipt;
    }
    if (name === 'GetItem') {
      const row = this.db.prepare('SELECT * FROM coordination_item WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, body.resourceId);
      if (!row) fail('NotFound', 'Item not found', 404);
      this.authorize(JSON.parse(this.plan(row.plan_id).definition));
      return { contractVersion: '1', item: JSON.parse(row.snapshot), eventCursor: this.cursor(this.watermark()) };
    }
    const row = this.plan(body.resourceId), definition = JSON.parse(row.definition);
    this.authorize(definition);
    const items = this.db.prepare('SELECT snapshot FROM coordination_item WHERE tenant=? AND owner=? AND plan_id=? ORDER BY id').all(this.tenant, this.owner, row.id)
      .map(record => { const item = JSON.parse(record.snapshot); return { itemId: item.itemId, resourceVersion: item.resourceVersion, state: item.state, currentAttemptId: item.currentAttemptId, achievedMilestones: item.achievedMilestones }; });
    return { contractVersion: '1', planId: row.id, resourceVersion: row.version, state: row.state, definition, items, eventCursor: this.cursor(this.watermark()) };
  }
  pendingNotifications(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('InvalidRequest', 'Notification limit must be 1..100', 400);
    return this.db.prepare('SELECT o.payload FROM forge_outbox o JOIN coordination_event e ON e.tenant=o.tenant AND e.sequence=o.ordinal WHERE o.tenant=? AND e.owner=? AND o.status=? ORDER BY o.ordinal LIMIT ?')
      .all(this.tenant, this.owner, 'pending', limit).map(row => {
        const event = JSON.parse(row.payload);
        const item = this.db.prepare('SELECT plan_id FROM coordination_item WHERE tenant=? AND owner=? AND id=?').get(this.tenant, this.owner, event.resourceId);
        this.authorize(JSON.parse(this.plan(item?.plan_id ?? event.resourceId).definition));
        return event;
      });
  }
}
