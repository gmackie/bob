import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HEARTBEAT_MS = 30_000;

/** Pushes coordinator plan and item snapshots to Bob's SdlcEdge. Read-only:
 * it never changes domain state, and keeps its checkpoint in a separate database. */
export function edgeExporter({ coordinator, endpoint, token, checkpoint, fetch: send = fetch, timeoutMs = 5000, now = Date.now }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/sdlc/ingest') throw new Error('Edge needs an HTTPS /api/sdlc/ingest endpoint');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !checkpoint || checkpoint === ':memory:') throw new Error('Invalid edge configuration');
  const source = coordinator.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  const destination = existsSync(checkpoint) ? realpathSync(checkpoint) : resolve(checkpoint);
  if (source && realpathSync(source) === destination) throw new Error('Edge checkpoint must be a separate database');
  const db = new DatabaseSync(checkpoint);
  db.exec('CREATE TABLE IF NOT EXISTS edge_checkpoint (owner TEXT PRIMARY KEY, position INTEGER NOT NULL, sent_at INTEGER NOT NULL)');
  const owner = JSON.stringify([coordinator.tenant, coordinator.owner, url.href]);
  const read = () => db.prepare('SELECT position, sent_at FROM edge_checkpoint WHERE owner=?').get(owner);
  const save = position => db.prepare('INSERT INTO edge_checkpoint VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET position=excluded.position, sent_at=excluded.sent_at').run(owner, position, now());
  const reset = () => db.prepare('DELETE FROM edge_checkpoint WHERE owner=?').run(owner);
  const q = (name, body) => coordinator.call(name, { contractVersion: '1', ...body });

  function snapshot() {
    // Read the watermark first: anything written during the scan is re-sent as a change.
    const watermark = coordinator.watermark(), plans = [], items = [];
    let afterPlanId = null;
    do {
      const page = q('ListPlans', { limit: 50, ...(afterPlanId ? { afterPlanId } : {}) });
      for (const entry of page.plans) {
        const plan = q('GetPlan', { resourceId: entry.planId });
        plans.push(plan);
        for (const summary of plan.items) items.push(q('GetItem', { resourceId: summary.itemId }).item);
      }
      afterPlanId = page.nextPlanId;
    } while (afterPlanId);
    return { kind: 'snapshot', watermark, plans, items };
  }

  function changes(position) {
    const page = q('ReadEvents', { cursor: coordinator.cursor(position), limit: 100 });
    if (!page.events.length) return null;
    const plans = [], items = [];
    for (const id of new Set(page.events.map(event => event.resourceId))) {
      try { items.push(q('GetItem', { resourceId: id }).item); }
      catch (error) { if (error.code !== 'NotFound') throw error; plans.push(q('GetPlan', { resourceId: id })); }
    }
    return { kind: 'changes', fromSequence: position, watermark: page.events.at(-1).sequence, plans, items };
  }

  async function post(batch) {
    const response = await send(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractVersion: '1', ...batch }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Edge unavailable'); }
    const result = await response.json();
    if (result.resync === true) { reset(); throw new Error('Edge requested a fresh snapshot'); }
    if (result.accepted !== true || result.watermark !== batch.watermark) throw new Error('Edge did not accept the batch');
  }

  return {
    async flush() {
      const state = read();
      let batch = null;
      if (!state) batch = snapshot();
      else {
        try { batch = changes(state.position); }
        catch (error) { if (error.code !== 'CursorExpired') throw error; batch = snapshot(); }
        if (!batch) {
          if (now() - state.sent_at < HEARTBEAT_MS) return { kind: 'idle', sent: 0 };
          batch = { kind: 'heartbeat', watermark: state.position, plans: [], items: [] };
        }
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
