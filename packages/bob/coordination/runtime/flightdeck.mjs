import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Separate analytics checkpoint: never changes domain state or Kanbanger delivery. */
export function flightdeckExporter({ coordinator, endpoint, token, checkpoint, fetch: send = fetch, timeoutMs = 2000 }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/server/events') throw new Error('Flightdeck needs an HTTPS server events endpoint');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !checkpoint || checkpoint === ':memory:') throw new Error('Invalid Flightdeck configuration');
  const source = coordinator.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  const destination = existsSync(checkpoint) ? realpathSync(checkpoint) : resolve(checkpoint);
  if (source && realpathSync(source) === destination) throw new Error('Flightdeck checkpoint must be a separate database');
  const db = new DatabaseSync(checkpoint);
  db.exec('CREATE TABLE IF NOT EXISTS checkpoint (owner TEXT PRIMARY KEY, position INTEGER NOT NULL)');
  const owner = JSON.stringify([coordinator.tenant, coordinator.owner, url.href]);
  return {
    async flush() {
      const position = db.prepare('SELECT position FROM checkpoint WHERE owner=?').get(owner)?.position ?? 0;
      const rows = coordinator.db.prepare('SELECT rowid AS position,id,fact,payload,created_at FROM coordination_issue_effect WHERE tenant=? AND owner=? AND rowid>? ORDER BY rowid LIMIT 50').all(coordinator.tenant, coordinator.owner, position);
      if (!rows.length) return { exported: 0 };
      const events = rows.map(row => {
        const payload = JSON.parse(row.payload);
        // An explicit scalar allowlist: never serialize work, errors, evidence URLs or credentials.
        const props = { fact: row.fact };
        for (const key of ['planId', 'itemId', 'requestId', 'attemptId', 'environmentId', 'executionId', 'executionProfileId']) {
          if (typeof payload[key] === 'string') props[key] = payload[key].slice(0, 256);
        }
        if (typeof payload.currentAttempt === 'boolean') props.currentAttempt = payload.currentAttempt;
        return { kind: 'track', eventId: createHash('sha256').update(JSON.stringify([coordinator.tenant, coordinator.owner, row.id])).digest('hex'), name: `bob.coordination.${row.fact}`, ts: Date.parse(row.created_at), props };
      });
      const response = await send(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Flightdeck export unavailable'); }
      const result = await response.json();
      if (result.accepted !== events.length || result.rejected !== 0) throw new Error('Flightdeck did not accept the full batch');
      db.prepare('INSERT INTO checkpoint VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET position=excluded.position').run(owner, rows.at(-1).position);
      return { exported: events.length };
    },
    close() { db.close(); },
  };
}

export function loadFlightdeckConfig(path, env = process.env) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof config.tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(config.tokenEnv)) throw new Error('Flightdeck tokenEnv is required');
  return { endpoint: config.endpoint, checkpoint: config.checkpoint, token: env[config.tokenEnv] };
}
