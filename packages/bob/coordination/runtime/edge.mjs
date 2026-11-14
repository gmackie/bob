import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HEARTBEAT_MS = 30_000;
// The edge refuses larger ingest bodies (413): keep in step with MAX_INGEST_BYTES in apps/bob/worker/sdlc/store.ts.
export const MAX_BATCH_BYTES = 1_000_000;
const PAGE = 50, EVENTS = 100;
// Terminal plans (completed, cancelled) reach the edge through change batches when
// they finish; snapshots carry only the plans that can still move.
const LIVE_PLAN_STATES = ['draft', 'active', 'paused', 'cancelling'];

/** Pushes coordinator plan and item snapshots to Bob's SdlcEdge. Read-only:
 * it never changes domain state, and keeps its checkpoint in a separate database. */
export function edgeExporter({ coordinator, endpoint, token, checkpoint, fetch: send = fetch, timeoutMs = 5000, now = Date.now, maxBytes = MAX_BATCH_BYTES }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/sdlc/ingest') throw new Error('Edge needs an HTTPS /api/sdlc/ingest endpoint');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !checkpoint || checkpoint === ':memory:') throw new Error('Invalid edge configuration');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid edge configuration');
  const source = coordinator.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  const destination = existsSync(checkpoint) ? realpathSync(checkpoint) : resolve(checkpoint);
  if (source && realpathSync(source) === destination) throw new Error('Edge checkpoint must be a separate database');
  const db = new DatabaseSync(checkpoint);
  db.exec('CREATE TABLE IF NOT EXISTS edge_checkpoint (owner TEXT PRIMARY KEY, position INTEGER NOT NULL, sent_at INTEGER NOT NULL)');
  const owner = JSON.stringify([coordinator.tenant, coordinator.owner, url.href]);
  const read = () => db.prepare('SELECT position, sent_at FROM edge_checkpoint WHERE owner=?').get(owner);
  const save = position => db.prepare('INSERT INTO edge_checkpoint VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET position=excluded.position, sent_at=excluded.sent_at').run(owner, position, now());
  const reset = () => db.prepare('DELETE FROM edge_checkpoint WHERE owner=?').run(owner);
  // Direct queries: the caller holds one read transaction, so bodies must stay contract-shaped.
  const q = (name, body) => coordinator.query(name, { contractVersion: '1', ...body });
  // A plan whose target or issue project left the trusted policy is not exported.
  const allowed = fn => { try { return fn(); } catch (error) { if (error.code === 'Forbidden') return null; throw error; } };
  const livePlanIds = coordinator.db.prepare(`SELECT id FROM coordination_plan WHERE tenant=? AND owner=? AND id>? AND state IN (${LIVE_PLAN_STATES.map(() => '?').join(',')}) ORDER BY id LIMIT ?`);
  const eventRows = coordinator.db.prepare('SELECT resource_id, sequence FROM coordination_event WHERE tenant=? AND owner=? AND sequence>? ORDER BY sequence LIMIT ?');

  function snapshot() {
    const watermark = coordinator.watermark(), plans = [], items = [];
    let afterPlanId = '', page;
    do {
      // Not ListPlans: it authorizes every row, so one out-of-policy plan would fail the page.
      page = livePlanIds.all(coordinator.tenant, coordinator.owner, afterPlanId, ...LIVE_PLAN_STATES, PAGE);
      for (const { id } of page) {
        const plan = allowed(() => q('GetPlan', { resourceId: id }));
        if (!plan) continue;
        plans.push(plan);
        for (const summary of plan.items) {
          const item = allowed(() => q('GetItem', { resourceId: summary.itemId }).item);
          if (item) items.push(item);
        }
      }
      afterPlanId = page.at(-1)?.id;
    } while (page.length === PAGE);
    return { kind: 'snapshot', watermark, plans, items };
  }

  function changes(position) {
    coordinator.parseCursor(coordinator.cursor(position)); // CursorExpired when the checkpoint is ahead of this store
    // Not ReadEvents: it authorizes every event, so one out-of-policy resource would fail the page.
    const events = eventRows.all(coordinator.tenant, coordinator.owner, position, EVENTS);
    if (!events.length) return null;
    const plans = [], items = [];
    for (const id of new Set(events.map(event => event.resource_id))) {
      const item = allowed(() => {
        try { return q('GetItem', { resourceId: id }).item; }
        catch (error) { if (error.code !== 'NotFound') throw error; return undefined; }
      });
      if (item) { items.push(item); continue; }
      if (item === null) continue;
      const plan = allowed(() => q('GetPlan', { resourceId: id }));
      if (plan) plans.push(plan);
    }
    return { kind: 'changes', fromSequence: position, watermark: events.at(-1).sequence, plans, items };
  }

  /** One deferred read transaction: a consistent view without a write lock. */
  function readBatch(fn) {
    coordinator.db.exec('BEGIN');
    try { const batch = fn(); coordinator.db.exec('COMMIT'); return batch; }
    catch (error) { coordinator.db.exec('ROLLBACK'); throw error; }
  }

  async function post(batch) {
    const body = JSON.stringify({ contractVersion: '1', ...batch });
    const bytes = Buffer.byteLength(body);
    if (bytes > maxBytes) throw new Error(`Edge batch too large: ${bytes} bytes`);
    const response = await send(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Edge unavailable'); }
    const result = await response.json();
    if (result.resync === true) { reset(); throw new Error('Edge requested a fresh snapshot'); }
    if (result.accepted !== true || result.watermark !== batch.watermark) throw new Error('Edge did not accept the batch');
  }

  return {
    async flush() {
      const state = read();
      // The transaction closes here, before any network work.
      let batch = readBatch(() => {
        if (!state) return snapshot();
        try { return changes(state.position); }
        catch (error) { if (error.code !== 'CursorExpired') throw error; return snapshot(); }
      });
      if (!batch) {
        if (now() - state.sent_at < HEARTBEAT_MS) return { kind: 'idle', sent: 0 };
        batch = { kind: 'heartbeat', watermark: state.position, plans: [], items: [] };
      }
      await post(batch);
      save(batch.watermark);
      return { kind: batch.kind, sent: batch.plans.length + batch.items.length };
    },
    close() { db.close(); },
  };
}

export function loadEdgeConfig(path, env = process.env) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof config.tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(config.tokenEnv)) throw new Error('Edge tokenEnv is required');
  return { endpoint: config.endpoint, checkpoint: config.checkpoint, token: env[config.tokenEnv] };
}
